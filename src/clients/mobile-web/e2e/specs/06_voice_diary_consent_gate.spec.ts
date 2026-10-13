/**
 * Spec 06 — Voice Diary end-to-end consent gate (@persona:Farmer)
 *
 * spec_id: voice-diary-e2e-2026-05-17 (Envelope G — Playwright e2e smoke)
 *
 * Verifies the full Settings -> Voice Diary journey from the Farmer's
 * perspective, in NORMAL navigation (no test-only door):
 *
 *   1. Launch the app and log in (Purvesh fixture).
 *   2. Open the Setup Hub (profile avatar in the header) and tap the
 *      "Settings" row (data-testid hub-settings-voice-diary). The header gear
 *      that used to lead here was removed with the floating header, and for a
 *      while nothing in the signed-in app reached Settings at all; this step
 *      is the regression guard for that.
 *   3. Consent gate: the retention toggle starts OFF (server has no grant).
 *      DECLINE path - toggle ON, the first-grant attestation opens, tap the
 *      secondary "not now" button: the banner closes, the toggle stays OFF and
 *      the server still has NO grant.
 *   4. ACCEPT path - toggle ON, confirm: the server records
 *      fullHistoryJournal=true and the toggle is ON.
 *   5. Retention consent survives a full page reload (read back from the
 *      server, not from component state).
 *   6. Record a clip. On chromium this drives the REAL recorder (MediaRecorder
 *      fed by Chromium's fake audio device: --use-fake-device-for-media-stream
 *      --use-fake-ui-for-media-stream). Other engines have no fake device, so
 *      the same row shape is seeded instead. Either way the clip must land in
 *      the PER-USER database (AgriLogDB_u_<userId>), never the legacy
 *      AgriLogDB.
 *   7. Open the Voice Diary from the Settings link: the clip's calendar dot,
 *      day list and player card are visible, with the granted retention banner.
 *      PLAYBACK: tap play and assert the <audio> element actually advances.
 *   8. The clip is still there after a reload (persisted in the per-user DB).
 *   9. Revoke: toggle OFF opens the "stop future" confirmation; confirm. A
 *      retained-tier persist attempt now fails closed with ConsentRequired,
 *      the diary shows the denied banner, and the already-recorded clip is
 *      still listed (revoking stops FUTURE retention, it does not delete).
 *
 * Recording rationale:
 *  Playwright cannot produce deterministic audio bytes from a real microphone,
 *  but Chromium's fake media device produces a synthetic tone stream that the
 *  app's own MediaRecorder encodes, so the recorder -> Dexie write path is
 *  exercised for real. What headless cannot prove: audible output (we assert
 *  the media element's clock advances, not that sound reaches a speaker) and
 *  the server-side AI parse of the clip (Sarvam/Gemini are not reachable from a
 *  throwaway backend).
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
import { selectFirstPlotLogContext } from '../fixtures/logContextHelper';

const PURVESH_PHONE = '8888888888';
const PURVESH_PASSWORD = 'Testuser@123';

const BACKEND_URL = process.env.E2E_API_URL ?? 'http://localhost:5000';

// UUID v4 (the backend declares clipId as Guid). Used for the seeded clip on
// engines without a fake audio device, and for the negative-path persist.
const SEEDED_CLIP_ID = '11111111-2222-3333-4444-555555555555';
const NEGATIVE_PERSIST_CLIP_ID = '22222222-3333-4444-5555-666666666666';

// Chromium's synthetic microphone: a tone stream, no prompt. Ignored by
// engines that do not know the flags (they take the seeded-clip branch).
test.use({
    permissions: ['microphone'],
    launchOptions: {
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
});

interface AuthSessionShape {
    userId: string;
}

// The access token is deliberately NOT persisted by the app (CodeQL
// hardening), so the bearer is taken from the app's own API calls instead.
const bearerByPage = new WeakMap<Page, { token: string | null }>();

function captureBearer(page: Page): void {
    const box = { token: null as string | null };
    bearerByPage.set(page, box);
    page.on('request', (req) => {
        if (!req.url().startsWith(BACKEND_URL)) return;
        const auth = req.headers()['authorization'];
        if (auth && auth.startsWith('Bearer ')) box.token = auth.slice('Bearer '.length);
    });
}

async function bearerToken(page: Page): Promise<string> {
    await expect
        .poll(() => bearerByPage.get(page)?.token ?? null, { timeout: 15_000, message: 'app never sent an authenticated API call' })
        .not.toBeNull();
    return bearerByPage.get(page)!.token as string;
}

async function readSession(page: Page): Promise<AuthSessionShape> {
    const session = await page.evaluate(() => {
        const raw = window.localStorage.getItem('agrisync_auth_session_v1');
        if (!raw) return null;
        try {
            return JSON.parse(raw) as AuthSessionShape;
        } catch {
            return null;
        }
    });
    if (!session?.userId) {
        throw new Error('No session cached in localStorage - login likely failed');
    }
    return session;
}

/**
 * The database the app routes this signed-in farmer to. Mirrors
 * userDatabaseName.resolveDatabaseNameForUser: the farmer recorded as the
 * device's first user adopts the legacy `AgriLogDB`; every other farmer gets
 * `AgriLogDB_u_<id>`.
 */
async function activeDbName(page: Page): Promise<string> {
    const { userId } = await readSession(page);
    const owner = await page.evaluate(() => window.localStorage.getItem('agrisync_legacy_db_owner_v1'));
    return owner === userId ? 'AgriLogDB' : `AgriLogDB_u_${encodeURIComponent(userId)}`;
}

/** Every IndexedDB database whose name starts with AgriLogDB. */
async function listAgriDatabases(page: Page): Promise<string[]> {
    return page.evaluate(async () =>
        (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith('AgriLogDB')),
    );
}

interface ClipRow {
    id: string;
    sizeBytes: number;
    blobSize: number;
    mimeType: string;
}

/** voiceClips rows from a named database; [] if the database is absent. */
async function readVoiceClips(page: Page, dbName: string): Promise<ClipRow[]> {
    return page.evaluate(async (name) => {
        const names = (await indexedDB.databases()).map((d) => d.name);
        if (!names.includes(name)) return [] as ClipRow[];
        return new Promise<ClipRow[]>((resolve) => {
            const req = indexedDB.open(name);
            req.onerror = () => resolve([]);
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('voiceClips')) {
                    db.close();
                    resolve([]);
                    return;
                }
                const all = db.transaction('voiceClips', 'readonly').objectStore('voiceClips').getAll();
                all.onsuccess = () => {
                    db.close();
                    resolve(
                        (all.result as Array<Record<string, unknown>>).map((r) => ({
                            id: String(r.id),
                            sizeBytes: Number(r.sizeBytes ?? 0),
                            blobSize: r.localBlob instanceof Blob ? r.localBlob.size : 0,
                            mimeType: String(r.mimeType ?? ''),
                        })),
                    );
                };
                all.onerror = () => {
                    db.close();
                    resolve([]);
                };
            };
        });
    }, dbName);
}

/** Seed one voice clip into the PER-USER database (engines without a fake mic). */
async function seedLocalVoiceClip(page: Page, dbName: string, clipId: string): Promise<void> {
    await page.evaluate(async ({ id, name }) => {
        const nowMs = Date.now();
        const recordedAtUtc = new Date(nowMs).toISOString();
        const expiresAtUtc = new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString();
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open(name);
            req.onerror = () => reject(new Error(`${name} open failed`));
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('voiceClips')) {
                    db.close();
                    reject(new Error(`voiceClips store missing from ${name}`));
                    return;
                }
                const put = db.transaction('voiceClips', 'readwrite').objectStore('voiceClips').put({
                    id,
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
                });
                put.onsuccess = () => {
                    db.close();
                    resolve();
                };
                put.onerror = () => {
                    db.close();
                    reject(new Error('voiceClips put failed'));
                };
            };
        });
    }, { id: clipId, name: dbName });
}

/**
 * Normal navigation to Settings: header profile avatar -> Setup Hub ->
 * "Settings" row. The route is state-machine driven (not URL), so we walk it
 * by tapping, exactly like a farmer.
 */
async function openSettings(page: Page): Promise<void> {
    const avatar = page.getByTestId('header-setup-hub');
    await expect(avatar).toBeVisible({ timeout: 15_000 });
    await avatar.click();

    const settingsRow = page.getByTestId('hub-settings-voice-diary');
    await settingsRow.scrollIntoViewIfNeeded();
    await expect(settingsRow).toBeVisible({ timeout: 10_000 });
    await settingsRow.click();

    // The consent toggle is the canonical marker that pages/SettingsPage.tsx
    // is mounted (rendered right under the Voice Journal card).
    await expect(page.getByTestId('voice-retained-consent-toggle')).toBeVisible({ timeout: 15_000 });
}

/** The consent state exactly as the server holds it. */
async function readServerConsent(page: Page): Promise<{ status: number; fullHistoryJournal: boolean }> {
    const accessToken = await bearerToken(page);
    const res = await page.request.get(`${BACKEND_URL}/shramsafal/consent/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        failOnStatusCode: false,
    });
    if (!res.ok()) return { status: res.status(), fullHistoryJournal: false };
    const body = (await res.json().catch(() => ({}))) as { fullHistoryJournal?: boolean };
    return { status: res.status(), fullHistoryJournal: body.fullHistoryJournal === true };
}

/**
 * Open the Voice Diary from the Settings consent toggle's "Open Voice Diary"
 * link (data-testid voice-retained-open-diary).
 */
async function openVoiceDiary(page: Page): Promise<void> {
    const openLink = page.getByTestId('voice-retained-open-diary');
    await expect(openLink).toBeVisible({ timeout: 10_000 });
    await openLink.click();
    await expect(page.getByTestId('voice-diary-page')).toBeVisible({ timeout: 15_000 });
}

/** IST-adjusted date key, same arithmetic as the app's DateKeyService. */
async function todayKeyIst(page: Page): Promise<string> {
    return page.evaluate(() => {
        const ist = new Date(Date.now() + 330 * 60 * 1000);
        const y = ist.getUTCFullYear();
        const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
        const d = String(ist.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    });
}

/**
 * Drive the real recorder: pick a plot, switch to voice input, start, let the
 * fake tone run for ~3 s, stop. Returns the id of the voiceClips row that the
 * app wrote into the per-user database.
 */
async function recordClipWithFakeMic(page: Page, dbName: string): Promise<string> {
    await selectFirstPlotLogContext(page);
    await page.getByTestId('input-method-voice').click();

    const startBtn = page.getByRole('button', { name: 'Start Recording' });
    await expect(startBtn).toBeVisible({ timeout: 15_000 });
    await startBtn.click();

    const stopBtn = page.getByRole('button', { name: 'Stop Recording' });
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(3_000);
    await stopBtn.click();

    await expect
        .poll(async () => (await readVoiceClips(page, dbName)).length, {
            timeout: 30_000,
            message: 'recorder wrote no voiceClips row to the per-user DB',
        })
        .toBeGreaterThan(0);
    const clips = await readVoiceClips(page, dbName);
    return clips[0].id;
}

test.describe('Voice Diary consent gate @persona:Farmer', () => {
    test('Settings -> decline/accept retention consent -> record -> play -> reload -> revoke @persona:Farmer', async ({ page, browserName }) => {
        test.setTimeout(180_000);
        await resetAndSeed('purvesh-demo');

        // Shared-handset scenario: another farmer used this device first and
        // adopted the legacy `AgriLogDB`, so Purvesh is routed to his OWN
        // per-user database (AgriLogDB_u_<id>) - the path this journey must
        // prove. Set once, before any app code runs, and kept across reloads.
        await page.addInitScript(() => {
            if (!window.localStorage.getItem('agrisync_legacy_db_owner_v1')) {
                window.localStorage.setItem('agrisync_legacy_db_owner_v1', 'e2e-previous-farmer-on-this-handset');
            }
        });

        // --- 1. Launch + login -------------------------------------------
        captureBearer(page);
        await loginViaPassword(page, PURVESH_PHONE, PURVESH_PASSWORD);
        const dbName = await activeDbName(page);
        expect(dbName).toMatch(/^AgriLogDB_u_/);
        await expect
            .poll(async () => listAgriDatabases(page), { timeout: 20_000, message: 'per-user database was never created' })
            .toContain(dbName);

        // --- 2. Settings is reachable in normal navigation ----------------
        await openSettings(page);

        // --- 3. Consent gate: starts OFF; DECLINE keeps it OFF ------------
        const consentCheckbox = page.getByTestId('voice-retained-consent-checkbox');
        await expect(consentCheckbox).toBeVisible({ timeout: 10_000 });
        // /__e2e/reset does NOT clear ssf.user_consent_state (verified against
        // the schema: the row survives a reset, keyed on the fixture's fixed
        // user id), so a previous run may have left a grant behind. Start from
        // a known OFF state through the same UI a farmer would use.
        if (await consentCheckbox.isChecked()) {
            await consentCheckbox.click();
            await page.getByTestId('voice-retained-stop-future-confirm').click();
        }
        await expect(consentCheckbox).not.toBeChecked({ timeout: 10_000 });
        expect((await readServerConsent(page)).fullHistoryJournal).toBe(false);

        // The checkbox is controlled: the first ON tap opens the attestation
        // and the state only flips after the server round-trip, so use
        // click() (not check()) and assert the eventual outcome.
        await consentCheckbox.click();
        const firstGrantBanner = page.getByTestId('voice-retained-first-grant-banner');
        await expect(firstGrantBanner).toBeVisible({ timeout: 5_000 });
        await page.getByTestId('voice-retained-first-grant-dismiss').click();
        await expect(firstGrantBanner).toBeHidden({ timeout: 5_000 });
        await expect(consentCheckbox).not.toBeChecked();
        // Declining must not have written anything to the server.
        expect((await readServerConsent(page)).fullHistoryJournal).toBe(false);

        // --- 4. ACCEPT: confirm the attestation ---------------------------
        await consentCheckbox.click();
        await expect(firstGrantBanner).toBeVisible({ timeout: 5_000 });
        const confirmBtn = page.getByTestId('voice-retained-first-grant-confirm');
        await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
        await confirmBtn.click();
        await expect(firstGrantBanner).toBeHidden({ timeout: 10_000 });
        await expect(consentCheckbox).toBeChecked({ timeout: 10_000 });
        await expect.poll(async () => (await readServerConsent(page)).fullHistoryJournal, { timeout: 10_000 }).toBe(true);

        // --- 5. Retention consent survives a full reload -------------------
        await page.reload();
        await expect(page.getByTestId('main-view-transition')).toBeVisible({ timeout: 30_000 });
        await openSettings(page);
        await expect(page.getByTestId('voice-retained-consent-checkbox')).toBeChecked({ timeout: 10_000 });

        // --- 6. Record a clip (real recorder on chromium) -----------------
        // A reload lands on Home, where the recorder lives.
        await page.reload();
        await expect(page.getByTestId('main-view-transition')).toBeVisible({ timeout: 30_000 });
        let clipId: string;
        if (browserName === 'chromium') {
            clipId = await recordClipWithFakeMic(page, dbName);
            const row = (await readVoiceClips(page, dbName)).find((r) => r.id === clipId)!;
            // A real recording: non-empty audio bytes were stored.
            expect(row.blobSize).toBeGreaterThan(0);
            expect(row.mimeType).toMatch(/audio\//);
            test.info().annotations.push({ type: 'recorded-clip', description: `${clipId} ${row.mimeType} ${row.blobSize} bytes in ${dbName}` });
        } else {
            clipId = SEEDED_CLIP_ID;
            await seedLocalVoiceClip(page, dbName, clipId);
        }
        // Written to the per-user DB; neither the other farmer's legacy DB nor
        // the pre-identity boundary received it.
        expect((await readVoiceClips(page, dbName)).some((r) => r.id === clipId)).toBe(true);
        expect(await readVoiceClips(page, 'AgriLogDB')).toEqual([]);
        expect(await readVoiceClips(page, 'AgriLogDB_unidentified')).toEqual([]);

        // --- 7. Voice Diary shows the clip; playback advances --------------
        await openSettings(page);
        await openVoiceDiary(page);
        const todayKey = await todayKeyIst(page);
        await expect(page.getByTestId(`voice-diary-calendar-cell-${todayKey}`)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('voice-diary-day-list')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId(`voice-diary-clip-card-${clipId}`)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('voice-diary-retention-banner-granted')).toBeVisible({ timeout: 5_000 });

        if (browserName === 'chromium') {
            // Real audio: tapping play must start the media element and its
            // clock must advance (headless cannot prove it is audible).
            await page.getByTestId(`voice-diary-clip-play-${clipId}`).click();
            await expect
                .poll(
                    async () =>
                        page.evaluate(() => {
                            const a = document.querySelector('audio');
                            return a ? a.currentTime > 0 || (!a.paused && !a.ended) : false;
                        }),
                    { timeout: 10_000, message: 'audio element never started playing' },
                )
                .toBe(true);
        }

        // --- 8. Clip survives a reload (persisted per-user) ----------------
        await page.reload();
        await expect(page.getByTestId('main-view-transition')).toBeVisible({ timeout: 30_000 });
        expect((await readVoiceClips(page, dbName)).some((r) => r.id === clipId)).toBe(true);
        await openSettings(page);
        await openVoiceDiary(page);
        await expect(page.getByTestId(`voice-diary-clip-card-${clipId}`)).toBeVisible({ timeout: 15_000 });

        // --- 9. Revoke: stop-future confirmation, then fail-closed persist --
        await openSettings(page);
        await expect(consentCheckbox).toBeChecked();
        await consentCheckbox.click();
        // Turning OFF asks first and says what it does NOT do.
        const stopBanner = page.getByTestId('voice-retained-stop-future-banner');
        await expect(stopBanner).toBeVisible({ timeout: 5_000 });
        await page.getByTestId('voice-retained-stop-future-confirm').click();
        await expect(stopBanner).toBeHidden({ timeout: 10_000 });
        await expect(consentCheckbox).not.toBeChecked({ timeout: 10_000 });
        await expect.poll(async () => (await readServerConsent(page)).fullHistoryJournal, { timeout: 10_000 }).toBe(false);

        // A new retained-tier persist (the hop archiveToRetainedTierIfConsented
        // makes after a Dexie write) must fail closed with ConsentRequired.
        const accessToken = await bearerToken(page);
        const persistResponse = await page.request.post(`${BACKEND_URL}/shramsafal/voice-diary/persist`, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            data: {
                clipId: NEGATIVE_PERSIST_CLIP_ID,
                recordedAtUtc: new Date().toISOString(),
                // Well-formed but meaningless cipher payload: the consent gate
                // fires BEFORE shape validation, so it never reaches storage.
                cipherBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                dekId: 'test-dek-id',
                ivBase64: 'AAAAAAAAAAAAAAAA',
                authTagBase64: 'AAAAAAAAAAAAAAAAAAAAAA==',
                durationSeconds: 4,
                language: 'mr-IN',
            },
            failOnStatusCode: false,
        });
        expect(persistResponse.ok()).toBeFalsy();
        // ErrorKind.Forbidden -> 403 (some shape-violation paths answer 400).
        expect([400, 403]).toContain(persistResponse.status());
        const persistBody = await persistResponse.json().catch(() => ({}));
        expect(JSON.stringify(persistBody)).toMatch(/ConsentRequired/i);

        // Re-open the diary: denied banner, and the recorded clip is kept.
        await openVoiceDiary(page);
        await expect(page.getByTestId('voice-diary-retention-banner-denied')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId(`voice-diary-clip-card-${clipId}`)).toBeVisible({ timeout: 10_000 });
    });
});
