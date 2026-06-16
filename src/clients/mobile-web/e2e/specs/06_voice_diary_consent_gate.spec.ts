/**
 * Spec 06 — Voice Diary end-to-end consent gate (@persona:Farmer)
 *
 * spec_id: voice-diary-e2e-2026-05-17 (Envelope G — Playwright e2e smoke)
 *
 * Verifies the full FullHistoryJournal consent lifecycle from the Farmer's
 * perspective:
 *
 *   1. Launch the app and log in (Purvesh fixture).
 *   2. Open Settings via the AppHeader Settings button.
 *   3. Toggle `VoiceRetainedConsentToggle` ON — the first-grant attestation
 *      banner (`VoiceRetainedFirstGrantBanner`) opens; click "I agree" to
 *      POST `fullHistoryJournal=true` to /shramsafal/consent/me.
 *   4. Mock-record a voice clip — seed Dexie `voiceClips` directly with a
 *      row that mirrors what `persistVoiceClip()` writes after MediaRecorder
 *      stops. Real MediaRecorder + getUserMedia is intentionally NOT exercised
 *      in this spec (existing specs 01-05 follow the same pattern of stubbing
 *      capture rather than driving the browser's media APIs).
 *   5. Navigate to the new 'voiceDiary' route via the consent toggle's
 *      "Open Voice Diary" link.
 *   6. Assert: the seeded clip appears on today's date — both the calendar
 *      day-cell dot and the DayClipList player card are visible.
 *   7. Navigate back to Settings; toggle the consent OFF (no first-grant
 *      modal on toggle-OFF — direct PUT).
 *   8. Attempt a new retained-tier persist by calling
 *      `/shramsafal/voice-diary/persist` directly with the user's bearer
 *      token (this is what `archiveToRetainedTierIfConsented` does after a
 *      Dexie write, and it is the hop the consent gate guards). Persist must
 *      fail closed.
 *   9. Assert two things on the diary:
 *       (a) Retention banner switches to the denied state.
 *       (b) The persist response carries the contract error
 *           `ShramSafal.ConsentRequired` (or a 4xx with the canonical body).
 *
 * Mock-record rationale:
 *  The plan says "use a stub MediaRecorder or fixture upload — pattern
 *  depends on existing Playwright setup". Existing specs (02, 04) take the
 *  Dexie-seed / setInputFiles approach for the same reason: real
 *  getUserMedia is gated on browser permissions and Playwright's
 *  --permissions=microphone still cannot produce deterministic audio
 *  bytes. Seeding the Dexie row directly exercises the same display
 *  contract the VoiceDiaryPage reads (local clips before
 *  archiveToRetainedTierIfConsented runs).
 *
 * Backend dependency:
 *  This spec requires the backend to be running with `ALLOW_E2E_SEED=true`
 *  AND the Wave 1.B endpoints mounted under /shramsafal/voice-diary/*
 *  AND the Phase 06.4 consent endpoint /shramsafal/consent/me. All three
 *  ship in HEAD on `akash_edits` (Wave 1 + 2 are APPROVED at 7c9625c5).
 *  No Docker required — runs against the host Postgres :5433 per the
 *  team's local-no-Docker convention. CI mirrors this by spinning the
 *  same backend in the e2e.yml workflow.
 */

import { test, expect, type Page } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { loginViaPassword } from '../fixtures/loginHelper';

const PURVESH_PHONE = '8888888888';
const PURVESH_PASSWORD = 'Testuser@123';

const BACKEND_URL = process.env.E2E_API_URL ?? 'http://localhost:5000';

// Deterministic clip identifier used by the seed + the persist attempt.
// Format must be a UUID v4 because the backend's /voice-diary/persist
// endpoint declares clipId as Guid. Generated once and reused so the
// negative-path persist can target the same id without colliding with
// the seeded local row.
const SEEDED_CLIP_ID = '11111111-2222-3333-4444-555555555555';
const NEGATIVE_PERSIST_CLIP_ID = '22222222-3333-4444-5555-666666666666';

interface AuthSessionShape {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAtUtc: string;
}

/**
 * Open the AppHeader Settings button. The header is always mounted while
 * authenticated; the button is a `<button>` with an embedded Settings
 * lucide icon. The route transition is state-machine driven, not URL,
 * so we navigate by clicking — not page.goto.
 */
async function openSettings(page: Page): Promise<void> {
    // The Settings button lives in the sticky <header> AppHeader and has
    // no data-testid today. Anchor on the embedded lucide-settings SVG,
    // scoped to the <header> banner role so we don't race a Settings
    // icon elsewhere on the page (e.g. SchedulerPage uses the same icon
    // in its toolbar).
    const settingsBtn = page.getByRole('banner').getByRole('button').filter({
        has: page.locator('svg.lucide-settings'),
    }).first();
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    // Anchor on the consent toggle wrapper — it is the canonical marker
    // that the route-rendered SettingsPage (pages/SettingsPage.tsx) is
    // mounted. The toggle is rendered immediately below the existing
    // "Voice Journal" CTA card per D.19.
    await expect(page.getByTestId('voice-retained-consent-toggle')).toBeVisible({
        timeout: 15_000,
    });
}

/**
 * Seed a single voice clip directly into Dexie `voiceClips` so the
 * VoiceDiaryPage's local-clip query (records where expiresAtUtc > now)
 * picks it up. This stands in for a successful `persistVoiceClip()`
 * call after MediaRecorder finishes — same row shape, same indexes.
 *
 * The seed deliberately omits ciphertext/iv/wrappedDekId. VoiceDiaryPage
 * does not read those fields; only DayClipList playback would, and
 * playback is gated on a "play" click that this spec does NOT exercise.
 */
async function seedLocalVoiceClipForToday(page: Page, clipId: string): Promise<void> {
    await page.evaluate(async ({ id }) => {
        const nowMs = Date.now();
        const expiryMs = nowMs + 30 * 24 * 60 * 60 * 1000;
        const recordedAtUtc = new Date(nowMs).toISOString();
        const expiresAtUtc = new Date(expiryMs).toISOString();

        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('AgriLogDB');
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('voiceClips')) {
                    db.close();
                    reject(new Error('voiceClips store missing from AgriLogDB'));
                    return;
                }
                const tx = db.transaction('voiceClips', 'readwrite');
                const store = tx.objectStore('voiceClips');
                const row = {
                    id,
                    // farmId left blank — VoiceDiaryPage does not filter on it.
                    farmId: '00000000-0000-0000-0000-000000000001',
                    recordedAtUtc,
                    durationMs: 4500,
                    mimeType: 'audio/webm',
                    sizeBytes: 1024,
                    status: 'recorded',
                    retentionPolicy: 'processing_30d',
                    expiresAtUtc,
                    createdAt: recordedAtUtc,
                    updatedAt: recordedAtUtc,
                };
                const putReq = store.put(row);
                putReq.onsuccess = () => {
                    db.close();
                    resolve();
                };
                putReq.onerror = () => {
                    db.close();
                    reject(new Error('voiceClips put failed'));
                };
            };
            req.onerror = () => reject(new Error('AgriLogDB open failed'));
        });
    }, { id: clipId });
}

/**
 * Read the bearer token the app cached after login. Used by the
 * negative-path persist that calls the backend directly outside the
 * app's axios instance — we need to mirror the same Authorization
 * header the app would have sent.
 */
async function readBearerToken(page: Page): Promise<string> {
    const session = await page.evaluate(() => {
        const raw = window.localStorage.getItem('agrisync_auth_session_v1');
        if (!raw) return null;
        try {
            return JSON.parse(raw) as AuthSessionShape;
        } catch {
            return null;
        }
    });
    if (!session?.accessToken) {
        throw new Error('No accessToken cached in localStorage — login likely failed');
    }
    return session.accessToken;
}

/**
 * Open the Voice Diary surface from the Settings consent toggle. The
 * toggle renders an "Open Voice Diary" link (data-testid
 * `voice-retained-open-diary`) when an `onOpenVoiceDiary` prop is wired
 * — which `pages/SettingsPage.tsx` does (D.19).
 */
async function openVoiceDiary(page: Page): Promise<void> {
    const openLink = page.getByTestId('voice-retained-open-diary');
    await expect(openLink).toBeVisible({ timeout: 10_000 });
    await openLink.click();
    await expect(page.getByTestId('voice-diary-page')).toBeVisible({ timeout: 15_000 });
}

test.describe('Voice Diary consent gate @persona:Farmer', () => {
    test('grant → record → diary shows clip; revoke → persist fails with ConsentRequired @persona:Farmer', async ({ page }) => {
        await resetAndSeed('purvesh-demo');

        // --- 1. Launch + login ------------------------------------------
        await loginViaPassword(page, PURVESH_PHONE, PURVESH_PASSWORD);

        // --- 2. Navigate to Settings ------------------------------------
        await openSettings(page);

        // --- 3. Toggle FullHistoryJournal ON via the checkbox; expect
        //       the first-grant attestation modal to appear, then click
        //       "I agree" to persist the grant. --------------------------
        const consentCheckbox = page.getByTestId('voice-retained-consent-checkbox');
        await expect(consentCheckbox).toBeVisible({ timeout: 10_000 });
        // Sanity: the checkbox starts OFF because /__e2e/reset wipes any
        // prior user_consents row written by an earlier run. (The endpoint
        // returns 404 → useFullHistoryJournalConsent defaults to false.)
        await expect(consentCheckbox).not.toBeChecked();
        // NOTE: this is a *controlled* checkbox — VoiceRetainedConsentToggle
        // intercepts the first ON click and opens the first-grant attestation
        // modal BEFORE persisting (server PUT) and BEFORE the controlled
        // `checked` state flips. Playwright's `.check()` asserts post-click
        // state and would fail here because the state stays false until the
        // modal flow completes. Use `.click()` (no post-state assertion); the
        // explicit `toBeChecked` assertion after the modal confirm validates
        // the eventual real outcome.
        await consentCheckbox.click();

        const firstGrantBanner = page.getByTestId('voice-retained-first-grant-banner');
        await expect(firstGrantBanner).toBeVisible({ timeout: 5_000 });
        const confirmBtn = page.getByTestId('voice-retained-first-grant-confirm');
        await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
        await confirmBtn.click();

        // Modal closes + reload() re-fetches consent + checkbox is now ON.
        await expect(firstGrantBanner).toBeHidden({ timeout: 10_000 });
        await expect(consentCheckbox).toBeChecked({ timeout: 10_000 });

        // --- 4. Mock-record a voice clip --------------------------------
        // Seed Dexie directly (see helper docstring for rationale).
        await seedLocalVoiceClipForToday(page, SEEDED_CLIP_ID);

        // --- 5. Navigate to the Voice Diary -----------------------------
        await openVoiceDiary(page);

        // --- 6. Assert the seeded clip surfaces on today's date ---------
        // VoiceDiaryPage auto-advances `selectedDateKey` to the most
        // recent day that has clips. Today's date is the seed's date, so
        // the calendar should show a dot AND the DayClipList should
        // render a player card.
        //
        // Date key must be computed IST-adjusted (the app's canonical
        // DateKeyService logic) — naive `toISOString().slice(0,10)` would
        // mis-key around the IST midnight boundary. Compute it in-page
        // using the same IST offset constant the service uses.
        const todayKey = await page.evaluate(() => {
            const IST_OFFSET_MINUTES = 330;
            const istMs = Date.now() + IST_OFFSET_MINUTES * 60 * 1000;
            const ist = new Date(istMs);
            const y = ist.getUTCFullYear();
            const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
            const d = String(ist.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        });
        const dayCell = page.getByTestId(`voice-diary-calendar-cell-${todayKey}`);
        await expect(dayCell).toBeVisible({ timeout: 15_000 });

        const dayList = page.getByTestId('voice-diary-day-list');
        await expect(dayList).toBeVisible({ timeout: 10_000 });
        // ClipPlayerCard testid is `voice-diary-clip-card-${clip.id}` so
        // we can target the seeded clip exactly. If the testid scheme
        // changes upstream, the prefix locator below picks up any card.
        const seededCard = page.getByTestId(`voice-diary-clip-card-${SEEDED_CLIP_ID}`);
        await expect(seededCard).toBeVisible({ timeout: 10_000 });

        // While consent is granted, the granted-state retention banner
        // is the one that renders.
        await expect(
            page.getByTestId('voice-diary-retention-banner-granted'),
        ).toBeVisible({ timeout: 5_000 });

        // --- 7. Back to Settings; toggle OFF ----------------------------
        await openSettings(page);
        // Toggle OFF path does NOT open the first-grant modal (only ON
        // from a never-granted state does). The checkbox uncheck PUTs
        // fullHistoryJournal=false directly.
        await expect(consentCheckbox).toBeChecked();
        // OFF transition does NOT open the modal — VoiceRetainedConsentToggle
        // falls through to a direct PUT + reload, but the controlled `checked`
        // attribute only flips after the network round-trip resolves. Playwright's
        // `.uncheck()` would assert post-click state synchronously and race the
        // reload. Use `.click()` + the eventual `not.toBeChecked` assertion below.
        await consentCheckbox.click();
        // The first-grant banner must NOT appear on the OFF transition.
        await expect(firstGrantBanner).toBeHidden({ timeout: 5_000 });
        // After reload, the checkbox lands on unchecked.
        await expect(consentCheckbox).not.toBeChecked({ timeout: 10_000 });

        // --- 8. Attempt a new retained-tier persist directly against the
        //       backend with the user's bearer token. This mirrors what
        //       the in-app `archiveToRetainedTierIfConsented` would do
        //       after a fresh recording sealed into Dexie. ---------------
        const accessToken = await readBearerToken(page);
        const persistResponse = await page.request.post(
            `${BACKEND_URL}/shramsafal/voice-diary/persist`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    clipId: NEGATIVE_PERSIST_CLIP_ID,
                    recordedAtUtc: new Date().toISOString(),
                    // Minimal but well-formed cipher payload — the consent
                    // gate fires BEFORE shape validation, so these bytes
                    // never reach storage. We supply realistic base64 to
                    // avoid a false-positive 400 from payload checks.
                    cipherBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                    dekId: 'test-dek-id',
                    ivBase64: 'AAAAAAAAAAAAAAAA',
                    authTagBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                    durationSeconds: 4,
                    language: 'mr-IN',
                },
                failOnStatusCode: false,
            },
        );

        // --- 9. Assert persist fails closed with the canonical contract
        //       error AND the diary UI surfaces the denied-state banner.
        expect(persistResponse.ok()).toBeFalsy();
        // Per ShramSafal.Domain ConsentRequired error mapped through
        // ToErrorResult: ErrorKind.Forbidden → 403. (The handler also
        // rejects with Validation in some shape-violation paths; the
        // canonical consent-deny response code is 403 with body
        // `{ error: "ShramSafal.ConsentRequired", ... }`.)
        expect([400, 403]).toContain(persistResponse.status());
        const persistBody = await persistResponse.json().catch(() => ({}));
        expect(JSON.stringify(persistBody)).toMatch(/ConsentRequired/i);

        // Re-open the diary and confirm the denied-state retention banner
        // is now showing (proves the UI reads the revoked consent state
        // — the existing diary tab was opened pre-revoke; we re-navigate
        // so the page mounts with the new consent value).
        await openVoiceDiary(page);
        await expect(
            page.getByTestId('voice-diary-retention-banner-denied'),
        ).toBeVisible({ timeout: 10_000 });
    });
});
