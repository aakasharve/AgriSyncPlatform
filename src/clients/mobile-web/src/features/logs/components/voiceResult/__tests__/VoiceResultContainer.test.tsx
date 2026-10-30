// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE screen after he speaks, mounted with the
 * REAL container over a real Dexie (fake-indexeddb): real clips linked to logs, the real sync queue, the real
 * `verifyLog` use case. What is checked is what the farmer sees and what his taps send:
 *   - "लक्षात ठेवलं" (the screen exists only after the write) and NO server claim until the server applied it;
 *   - all eight parts, the unmentioned ones red, tappable, never a 0;
 *   - his words marked ONLY with verified phrases, and a tapped part shows its words;
 *   - spec I27 (founder D-44 / D-46, AMENDS I13): only the PRIMARY OWNER is offered "पक्कं आहे" on his own recording
 *     ("save and confirm"), never locked behind listening; it queues the existing verify for THAT log only, saying
 *     whether he heard his clip or read his words. Every other speaker sees it stay "पक्कं नाही";
 *   - the plot's whole day: earlier recordings newest first, ▶ only where the clip is on this phone, who spoke,
 *     confirmed or not; "बदला" opens the edit form; "मागे" + "आणखी सांगा"; no English, no "नोंद".
 *   - (round 2) an item the server could not verify is FLAGGED, never a plain fact, and its part stays red;
 *     a recording that named two plots is one recording with a "बदला" and an honest badge per plot; the confirm
 *     goes only to logs on their way to the server.
 *   - lane L6b (founder design): what he TYPED to Sathi lands here marked "लिहिलेलं", with no player and no "ऐका";
 *     the why-tiles ("श्रम साथीला हे का समजले?", first open, folded, dimming, his phrase highlighted, no made-up
 *     reason); sprays on one chip row and in one box, only what was said (no computed water, no identity words).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { triggerNow, auditAppend, grant } = vi.hoisted(() => ({ triggerNow: vi.fn(), auditAppend: vi.fn(), grant: { value: undefined as boolean | undefined } }));
// The server's cached labour grant (what EnsureCanVerify admits besides the owner tier).
vi.mock('../../../../labour/homeAttendanceDoor', async (orig) => ({
    ...(await orig<typeof import('../../../../labour/homeAttendanceDoor')>()),
    readCachedLabourGrant: () => grant.value,
}));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...a: unknown[]) => triggerNow(...a), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: (...a: unknown[]) => auditAppend(...a) } }),
}));
// The clip bytes: this test is about which clip plays and what hearing it unlocks, not about the seal.
// The farmer's language is Marathi; the few existing pieces that read it (the not-queued badge) get the real strings.
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = { language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') };
    return { useLanguage: () => ctx, useOptionalLanguage: () => ctx };
});
vi.mock('../../../../../infrastructure/voice/VoiceClipRetention', async (orig) => ({
    ...(await orig<typeof import('../../../../../infrastructure/voice/VoiceClipRetention')>()),
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const RAMESH = 'b2b2b2b2-0000-4000-8000-000000000002';
const NOW = 'c3c3c3c3-0000-4000-8000-000000000003';
const NOON = 'd4d4d4d4-0000-4000-8000-000000000004';
const MORNING = 'e5e5e5e5-0000-4000-8000-000000000005';
const DATE = '2026-10-26';

const SAID = 'दोन तास पाणी दिलं आणि चार मजूर आले';

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    ...over,
}) as unknown as DailyLog;

const HISTORY: DailyLog[] = [
    log(NOW, {
        fullTranscript: SAID,
        irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
        // The server could not find this phrase in his words: it must never be marked.
        labour: [{ id: 'lab', count: 4, sourceText: 'चार मजूर आले', provenanceVerified: false }],
        meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
    }),
    log(MORNING, {
        fullTranscript: 'सकाळी छाटणी केली',
        cropActivities: [{ id: 'crop-m', title: 'छाटणी', sourceText: 'छाटणी केली' }],
        meta: { createdAtISO: '2026-10-26T03:00:00.000Z', createdByOperatorId: RAMESH },
        verification: { status: LogVerificationStatus.VERIFIED, required: true },
    }),
    log(NOON, {
        fullTranscript: 'फवारणी केली',
        inputs: [{ id: 'inp-n', productName: 'गंधक', sourceText: 'फवारणी केली' }],
        meta: { createdAtISO: '2026-10-26T06:30:00.000Z', createdByOperatorId: ME },
    }),
];

const clipRow = (id: string, dailyLogId: string): VoiceClipCacheRecord => ({
    id, dailyLogId, farmId: 'farm-1', plotId: 'plot-1', recordedAtUtc: '2026-10-26T10:00:00.000Z', durationMs: 4000,
    mimeType: 'audio/webm', sizeBytes: 3, ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek',
    status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-11-25T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord);

interface FakeAudio { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; duration: number; currentTime: number; onended: (() => void) | null; ontimeupdate: (() => void) | null; onloadedmetadata: (() => void) | null }
let audios: FakeAudio[] = [];
const createAudio = () => {
    const a: FakeAudio = { play: vi.fn(async () => undefined), pause: vi.fn(), duration: 4, currentTime: 0, onended: null, ontimeupdate: null, onloadedmetadata: null };
    audios.push(a);
    return a as unknown as HTMLAudioElement;
};

const props = (over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => ({
    result: { logIds: [NOW], clipId: 'clip-now', key: 'clip-now|T', unclear: [] },
    history: HISTORY,
    farmerProfile: { activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
    operatorNameById: new Map([[RAMESH, 'रमेश']]),
    farmId: 'farm-1',
    farmRole: 'PrimaryOwner',
    placeLabel: 'द्राक्ष · प्लॉट १',
    syncQueuedById: new Map([[NOW, true]]),
    onEdit: vi.fn(),
    onBack: vi.fn(),
    onAddAnother: vi.fn(),
    createAudio,
    ...over,
});

const mount = (p: VoiceResultContainerProps) => render(<VoiceResultContainer {...p} />);
const verifyRows = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.VerifyLogV2);

beforeEach(async () => {
    vi.clearAllMocks();
    triggerNow.mockResolvedValue(undefined);
    auditAppend.mockResolvedValue(undefined);
    audios = [];
    grant.value = undefined;
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await getDatabase().voiceClips.bulkPut([clipRow('clip-now', NOW), clipRow('clip-noon', NOON)]);
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); clearAuthSession(); });

describe('the ONE result screen — what he reads', () => {
    it('says "लक्षात ठेवलं" and makes NO server claim until the server applied the save', async () => {
        mount(props());
        expect(screen.getByTestId('vr-remembered').textContent).toContain('लक्षात ठेवलं');
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(screen.queryByTestId('vr-on-server')).toBeNull();
    });

    it('names the server only once the queue holds the server\'s acknowledgement (APPLIED)', async () => {
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r1', mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: NOW },
            createdAt: 'T', status: 'APPLIED', retryCount: 0, updatedAt: 'T',
        } as never);
        mount(props());
        await waitFor(() => expect(screen.getByTestId('vr-on-server').textContent).toBe('श्रम सफलमध्ये साठवून ठेवलं'));
    });

    it('shows all EIGHT parts: the unmentioned ones red, "सांगितलं नाही", never a 0', () => {
        mount(props());
        const parts = within(screen.getByTestId('vr-parts'));
        // labour: the only labour item is one the server could NOT verify — it does not make the part "told" (the
        // ring's own rule), but he DID say it and it is listed below: "not sure" (amber), never "not said" (round 3).
        const told = ['irrigation', 'crop', 'inputs'];
        for (const key of ['crop', 'labour', 'irrigation', 'inputs', 'expense', 'machinery', 'observation', 'planned']) {
            const tile = parts.getByTestId(`vr-part-${key}`);
            expect(tile.getAttribute('data-told')).toBe(told.includes(key) ? 'yes' : key === 'labour' ? 'unsure' : 'no');
            if (!told.includes(key) && key !== 'labour') {
                expect(tile.tagName).toBe('BUTTON');
                expect(tile.textContent).toContain('सांगितलं नाही');
                expect(tile.className).toContain('red');
            }
        }
        const labour = parts.getByTestId('vr-part-labour');
        expect(labour.textContent).toContain('नक्की समजलं नाही');
        expect(labour.textContent).not.toContain('सांगितलं नाही');
        expect(labour.className).toContain('amber');
        expect(labour.tagName).not.toBe('BUTTON'); // saying it again would record it twice
        expect(screen.getByTestId('vr-parts').textContent).not.toMatch(/[0०]/);
    });

    it('a red part opens the mic for the same plot ("आणखी सांगा"), after stopping any clip', () => {
        const p = props();
        mount(p);
        fireEvent.click(screen.getByTestId('vr-part-machinery'));
        expect(p.onAddAnother).toHaveBeenCalledTimes(1);
    });

    it('marks his words ONLY with verified phrases, each tagged with its part; tapping a part shows its words', () => {
        mount(props());
        const words = screen.getByTestId('vr-words');
        expect(words.textContent).toContain('दोन तास पाणी');
        const marks = [...words.querySelectorAll('mark')];
        expect(marks.map(m => [m.textContent, m.getAttribute('data-part')])).toEqual([['दोन तास पाणी', 'irrigation']]);
        expect(within(words).getAllByTestId('vr-word-tag')).toHaveLength(1);
        // The labour phrase the server could not verify is plain text, never a coloured quote.
        expect(marks.some(m => m.textContent?.includes('चार मजूर'))).toBe(false);

        fireEvent.click(screen.getByTestId('vr-link-irrigation'));
        const card = screen.getByTestId('vr-link-card');
        expect(card.getAttribute('data-part')).toBe('irrigation');
        expect(card.textContent).toContain('“दोन तास पाणी”');
        expect(card.textContent).toContain('2 तास'); // what Sathi noted, as recorded
        expect(screen.queryByTestId('vr-link-labour')).toBeNull();
    });

    it('what THIS recording added is listed under "यातून काय समजलं"', () => {
        mount(props());
        const added = screen.getByTestId('vr-added');
        expect(added.textContent).toContain('यातून काय समजलं');
        expect(added.textContent).toContain('2 तास');
        expect(added.textContent).toContain('4 जण');
        expect(added.textContent).not.toContain('छाटणी'); // the morning's work is the day's, not this recording's
    });

    it('an item the server could NOT verify carries the approved flag, never stands as a plain fact', () => {
        mount(props());
        const labour = screen.getByTestId('vr-added-lab');
        expect(labour.getAttribute('data-verified')).toBe('no');
        expect(within(labour).getByTestId('vr-unsure-lab').textContent).toBe('हे मी नक्की ऐकलं नाही — बरोबर आहे का?');
        const water = screen.getByTestId('vr-added-irr');
        expect(water.getAttribute('data-verified')).toBe('yes');
        expect(within(water).queryByTestId('vr-unsure-irr')).toBeNull();
        // The day's labour row never headlines the unsure number.
        expect(screen.getByTestId('vr-day-head-labour').textContent).not.toContain('4 जण');
    });

    it('is the plot\'s WHOLE day: earlier recordings NEWEST FIRST, who spoke, confirmed or not, ▶ only where the clip is here', async () => {
        mount(props());
        expect(screen.getByTestId('vr-latest-who').textContent).toBe('तुम्ही');
        const earlier = screen.getByTestId('vr-earlier');
        const ids = [...earlier.querySelectorAll('[data-testid^="vr-earlier-"]')]
            .map(el => el.getAttribute('data-testid'))
            .filter(id => /^vr-earlier-[0-9a-f-]{36}$/.test(id ?? ''));
        expect(ids).toEqual([`vr-earlier-${NOON}`, `vr-earlier-${MORNING}`]);
        expect(screen.getByTestId(`vr-earlier-who-${MORNING}`).textContent).toBe('रमेश');
        expect(screen.getByTestId(`vr-earlier-state-${MORNING}`).textContent).toContain('पक्कं केलं');
        expect(screen.getByTestId(`vr-earlier-state-${NOON}`).textContent).toBe('पक्कं नाही');
        await waitFor(() => expect(screen.getByTestId(`vr-earlier-play-${NOON}`)).toBeTruthy());
        expect(screen.queryByTestId(`vr-earlier-play-${MORNING}`)).toBeNull(); // his clip is not on this phone
        expect(screen.getByTestId('vr-count').textContent).toBe('आज 3 वेळा सांगितलं');
    });

    it('has no English and no "नोंद" anywhere on the screen', async () => {
        const { container } = mount(props());
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(container.textContent).not.toMatch(/[A-Za-z]/);
        expect(container.textContent).not.toContain('नोंद');
        expect(screen.getByTestId('vr-back').textContent).toContain('मागे');
        expect(screen.getByTestId('vr-add-another').textContent).toContain('आणखी सांगा');
    });

    // I13-V3 m5 — OPEN for the founder's Marathi ruling: when a save will NOT reach the server, the kept honesty
    // badge says so in its APPROVED words (sync.notFiledBadgeTail, "शेतनोंदीत जाणार नाही"), which hold "नोंद".
    // Pinned here so that is the ONLY place the word can appear, and the screen still has no English.
    it('a save that will not reach the server: "नोंद" appears only inside the approved not-queued badge', async () => {
        const { container } = mount(props({ syncQueuedById: new Map([[NOW, false]]) }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(container.textContent).not.toMatch(/[A-Za-z]/);
        const badge = [...container.querySelectorAll('p')].find(el => el.textContent?.includes('शेतनोंदीत जाणार नाही'));
        expect(badge?.textContent).toBe('लक्षात ठेवलं ✓ — शेतनोंदीत जाणार नाही');
        expect((container.textContent ?? '').split('नोंद').length - 1).toBe(1);
    });

    // Lane F1 (review N9) — a record the server holds only as task lines says so, once on the screen and in its day
    // rows; a complete record says nothing. PROPOSED wording, and still no "नोंद" anywhere on the screen (PLR-D5 :65).
    it('a legacy-partial record says "जुनं काम — काही तपशील उपलब्ध नाहीत" on the screen and in its day row; a complete one does not', async () => {
        const legacy = HISTORY.map(l => (l.id === NOW ? { ...l, legacyPartial: true } : l)) as DailyLog[];
        const { container } = mount(props({ history: legacy }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());

        expect(screen.getByTestId('vr-legacy-note').textContent).toBe('जुनं काम — काही तपशील उपलब्ध नाहीत');
        expect(container.textContent).not.toContain('नोंद');
        expect(container.textContent).not.toMatch(/[A-Za-z]/);
        // The water row is open: this recording touched it.
        expect(screen.getByTestId('vr-day-irrigation').getAttribute('data-open')).toBe('yes');
        expect(screen.getAllByTestId(/^vr-day-legacy-/).length).toBeGreaterThan(0);
        expect(container.textContent).not.toMatch(/undefined|NaN/);
        cleanup();

        mount(props());
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(screen.queryByTestId('vr-legacy-note')).toBeNull();
        expect(screen.queryAllByTestId(/^vr-day-legacy-/)).toHaveLength(0);
    });
});

describe('the ONE result screen — what his taps do', () => {
    it('the OWNER is never made to listen: "वाचा आणि पक्कं करा" at once, "ऐका आणि पक्कं करा" once he heard it (D-44)', async () => {
        mount(props());
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect((screen.getByTestId('vr-confirm') as HTMLButtonElement).disabled).toBe(false);
        expect(screen.getByTestId('vr-confirm-basis').textContent).toBe('वाचा आणि पक्कं करा');
        expect(screen.getByTestId('vr-not-confirmed-badge').textContent).toBe('पक्कं नाही'); // D-46: until he confirms

        expect(screen.queryByTestId('vr-play-electric')).toBeNull(); // the flowing trace only while it plays
        await act(async () => { fireEvent.click(screen.getByTestId('vr-play')); });
        await waitFor(() => expect(audios).toHaveLength(1));
        expect(audios[0].play).toHaveBeenCalled();
        await waitFor(() => expect(screen.getByTestId('vr-play-electric')).toBeTruthy());

        act(() => { audios[0].onended?.(); });
        expect(screen.getByTestId('vr-confirm-basis').textContent).toBe('ऐका आणि पक्कं करा');

        await act(async () => {
            fireEvent.click(screen.getByTestId('vr-confirm'));
            fireEvent.click(screen.getByTestId('vr-confirm')); // a double tap must not queue twice
        });
        await waitFor(() => expect(screen.getByTestId('vr-confirm-done').textContent).toContain('तुम्ही पक्कं केलं'));
        // Only his words are claimed kept: the clip itself is kept 30 days (processing_30d), not for good.
        expect(screen.getByTestId('vr-kept-safe').textContent).toBe('तुमचे शब्द जपले आहेत');
        const rows = await verifyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ logId: NOW, verifierUserId: ME, decision: 'verify', reviewBasis: 'heard' });
    });

    it('no clip of it on this phone: he confirms by reading, and the verify says so ("read", D-44 read-not-heard)', async () => {
        await getDatabase().voiceClips.clear();
        mount(props());
        expect(screen.getByTestId('vr-latest').textContent).toContain('वाचा आणि पक्कं करा');
        expect(screen.queryByTestId('vr-play')).toBeNull();
        await act(async () => { fireEvent.click(screen.getByTestId('vr-confirm')); });
        await waitFor(() => expect(screen.getByTestId('vr-confirm-done')).toBeTruthy());
        const rows = await verifyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ logId: NOW, decision: 'verify', reviewBasis: 'read' });
    });

    it('lane F1 (D-46): the confirm names the record version this screen showed, once the phone knows it', async () => {
        await getDatabase().voiceClips.clear();
        mount(props({ history: HISTORY.map(l => (l.id === NOW ? { ...l, contentVersion: 3 } : l)) }));
        await act(async () => { fireEvent.click(screen.getByTestId('vr-confirm')); });
        await waitFor(() => expect(screen.getByTestId('vr-confirm-done')).toBeTruthy());
        const rows = await verifyRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toMatchObject({ logId: NOW, decision: 'verify', reviewBasis: 'read', logVersion: 3 });
    });

    it('a farm role that may not verify sees no confirm button at all (P5)', async () => {
        mount(props({ farmRole: 'Worker' }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(screen.queryByTestId('vr-confirm')).toBeNull();
        expect(await verifyRows()).toHaveLength(0);
    });

    it('"बदला" opens the edit form for this recording\'s log; "मागे" goes one step back', () => {
        const p = props();
        mount(p);
        fireEvent.click(screen.getByTestId('vr-edit'));
        expect(p.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: NOW }));
        fireEvent.click(screen.getByTestId('vr-back'));
        expect(p.onBack).toHaveBeenCalledTimes(1);
    });

    it('the not-queued honesty badge stays when the save will not reach the server', () => {
        mount(props({ syncQueuedById: new Map([[NOW, false]]) }));
        expect(screen.getByTestId('vr-latest').textContent).toContain('जाणार नाही');
        // A log that never reached the queue cannot be verified on the server: no confirm is offered for it (P5).
        expect(screen.queryByTestId('vr-confirm')).toBeNull();
        cleanup();
        mount(props({ syncQueuedById: new Map([[NOW, true]]) }));
        expect(screen.getByTestId('vr-latest').textContent).not.toContain('जाणार नाही');
    });

    it('the speaker is never asked to confirm his own recording (I27): a granted मुकादम and a co-owner see "पक्कं नाही", no button', async () => {
        for (const [farmRole, granted] of [['Mukadam', true], ['Mukadam', false], ['SecondaryOwner', undefined]] as const) {
            grant.value = granted;
            mount(props({ farmRole }));
            await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
            expect(screen.queryByTestId('vr-confirm')).toBeNull();
            expect(screen.getByTestId('vr-not-confirmed-badge').textContent).toBe('पक्कं नाही');
            cleanup();
        }
        expect(await verifyRows()).toHaveLength(0);
    });

    it('once the owner (or whoever the owner trusts) confirmed it, the speaker sees "पक्कं केलं"', async () => {
        const confirmed = [{ ...HISTORY[0], verification: { status: LogVerificationStatus.VERIFIED, required: true } } as DailyLog, ...HISTORY.slice(1)];
        mount(props({ farmRole: 'Worker', history: confirmed }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(screen.getByTestId('vr-confirmed-badge').textContent).toBe('पक्कं केलं');
        expect(screen.queryByTestId('vr-not-confirmed-badge')).toBeNull();
    });
});

describe('the ONE result screen — one recording, several plots; a stoppage; a typed entry', () => {
    const PLOT2 = 'f6f6f6f6-0000-4000-8000-000000000006';
    const AT = '2026-10-26T11:00:00.000Z';
    const TWO_PLOTS: DailyLog[] = [
        log(NOW, {
            fullTranscript: 'दोन्ही प्लॉटला पाणी दिलं',
            irrigation: [{ id: 'irr-a', durationHours: 1 }],
            meta: { createdAtISO: AT, createdByOperatorId: ME },
        }),
        log(PLOT2, {
            context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['plot-2'], selectedPlotNames: ['प्लॉट २'] }] },
            irrigation: [{ id: 'irr-b', durationHours: 1 }],
            meta: { createdAtISO: AT, createdByOperatorId: ME },
        }),
    ];

    it('one recording that named two plots: counted ONCE, a "बदला" per plot, and a not-queued badge only on the plot that will not go', () => {
        const p = props({
            result: { logIds: [NOW, PLOT2], clipId: 'clip-now', key: 'k2', unclear: [] },
            history: TWO_PLOTS,
            syncQueuedById: new Map([[NOW, true], [PLOT2, false]]),
        });
        mount(p);
        expect(screen.getByTestId('vr-count').textContent).toBe('आज पहिल्यांदा सांगितलं');
        expect(screen.getByTestId('vr-speakers').textContent).toContain('तुम्ही · 1 वेळा');
        expect(screen.queryByTestId('vr-edit')).toBeNull();
        expect(within(screen.getByTestId(`vr-plot-${NOW}`)).queryByText(/जाणार नाही/)).toBeNull();
        expect(screen.getByTestId(`vr-plot-${PLOT2}`).textContent).toContain('जाणार नाही');
        expect(screen.getByTestId(`vr-edit-${PLOT2}`).textContent).toContain('प्लॉट २');
        fireEvent.click(screen.getByTestId(`vr-edit-${PLOT2}`));
        expect(p.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: PLOT2 }));
    });

    it('the confirm goes only to the plot logs that are on their way to the server', async () => {
        await getDatabase().voiceClips.clear();
        mount(props({
            result: { logIds: [NOW, PLOT2], clipId: null, key: 'k3', unclear: [] },
            history: TWO_PLOTS,
            syncQueuedById: new Map([[NOW, true], [PLOT2, false]]),
        }));
        await act(async () => { fireEvent.click(screen.getByTestId('vr-confirm')); });
        await waitFor(() => expect(screen.getByTestId('vr-confirm-done')).toBeTruthy());
        expect((await verifyRows()).map(r => (r.payload as { logId: string }).logId)).toEqual([NOW]);
    });

    it('an earlier recording that named two plots is ONE row, not two', () => {
        const EARLY = '2026-10-26T02:00:00.000Z';
        const history = [
            HISTORY[0],
            log('99999999-0000-4000-8000-00000000000a', { fullTranscript: 'सकाळी पाणी', irrigation: [{ id: 'e1', durationHours: 1 }], meta: { createdAtISO: EARLY, createdByOperatorId: RAMESH } }),
            log('99999999-0000-4000-8000-00000000000b', {
                context: { selection: [{ cropId: 'c1', selectedPlotIds: ['plot-1', 'plot-2'], selectedPlotNames: ['प्लॉट १'] }] },
                irrigation: [{ id: 'e2', durationHours: 1 }], meta: { createdAtISO: EARLY, createdByOperatorId: RAMESH },
            }),
        ];
        mount(props({ history }));
        expect(screen.getByTestId('vr-count').textContent).toBe('आज 2 वेळा सांगितलं');
        expect(screen.getByTestId('vr-speakers').textContent).toContain('रमेश · 1 वेळा');
        expect(screen.getAllByTestId(/^vr-earlier-who-/)).toHaveLength(1);
    });

    it('a recording that only reports a stoppage still says what Sathi understood', () => {
        const stopped = log(NOW, {
            fullTranscript: 'पाऊस आला, काम झालं नाही',
            disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस आला', blockedSegments: [], sourceText: 'पाऊस आला' },
            meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
        });
        mount(props({ history: [stopped] }));
        const added = screen.getByTestId('vr-added');
        expect(within(added).getByTestId(`vr-blocker-${NOW}:blocker`).textContent).toContain('अडथळे / अडचणी');
        expect(added.textContent).toContain('पाऊस आला');
    });

    it('an earlier entry filled in BY HAND says "लिहिलेलं" and has no player', async () => {
        const typed = log(NOON, {
            labour: [{ id: 'lab-t', count: 3 }],
            meta: { createdAtISO: '2026-10-26T06:30:00.000Z', createdByOperatorId: ME, provenance: { source: 'manual', timestamp: 'T' } },
        });
        await getDatabase().voiceClips.clear();
        mount(props({ history: [HISTORY[0], typed] }));
        expect(screen.getByTestId(`vr-earlier-typed-${NOON}`).textContent).toContain('लिहिलेलं');
        expect(screen.queryByTestId(`vr-earlier-play-${NOON}`)).toBeNull();
        // L6b (design EarlierLog): the no-recording note stands where the player would be.
        expect(screen.getByTestId(`vr-earlier-typed-note-${NOON}`).textContent).toBe('आवाज रेकॉर्डिंग नाही. हे लिहून सांगितलेलं आहे.');
        expect(screen.queryByTestId(`vr-earlier-typed-${NOW}`)).toBeNull();
        // Round 3 (I13-V2-m5): an entry typed on the form is not a time he SAID it.
        expect(screen.getByTestId('vr-count').textContent).toBe('आज पहिल्यांदा सांगितलं');
        expect(screen.getByTestId('vr-speakers').textContent).toContain('तुम्ही · 1 वेळा');
    });

    it('the money he said with the labour makes खर्च told on the screen and shows the ₹ as he said it (round 3)', () => {
        const paid = log(NOW, {
            fullTranscript: 'चार मजूर आले, सोळाशे रुपये दिले',
            labour: [{ id: 'lab-p', count: 4, totalCost: 1600, sourceText: 'चार मजूर आले' }],
            meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
        });
        mount(props({ history: [paid] }));
        expect(screen.getByTestId('vr-part-expense').getAttribute('data-told')).toBe('yes'); // never a red "tell it again"
        expect(screen.getByTestId('vr-added').textContent).toContain('मजूर · ₹1600');
    });

    it('a save whose sync enqueue gave NO evidence (null) offers no confirm: its verify would reach the server before any create', async () => {
        mount(props({ syncQueuedById: new Map([[NOW, null]]) }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy());
        expect(screen.queryByTestId('vr-confirm')).toBeNull();
        expect(screen.getByTestId('vr-remembered').textContent).toContain('लक्षात ठेवलं'); // the phone write itself is still true
        expect(await verifyRows()).toHaveLength(0);
    });
});

describe('the ONE result screen — lane L6b (founder design)', () => {
    it('what he TYPED to Sathi: "लिहिलेलं", the no-recording note where the player was, no "ऐका", confirmed by reading', async () => {
        const typed = log(NOW, {
            fullTranscript: SAID,
            irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
            meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, provenance: { source: 'ai', timestamp: 'T' } },
            autoSavedFromVoice: true, typedEntry: true,
        });
        await getDatabase().voiceClips.clear();
        const { container } = mount(props({ history: [typed], result: { logIds: [NOW], clipId: null, key: '-|T', unclear: [], typed: true } }));
        expect(screen.getByTestId('vr-latest-typed').textContent).toBe('लिहिलेलं');
        expect(screen.getByTestId('vr-typed-note').textContent).toBe('आवाज रेकॉर्डिंग नाही. हे लिहून सांगितलेलं आहे.');
        expect(screen.queryByTestId('vr-play')).toBeNull();
        expect(container.textContent).not.toContain('ऐका');
        expect(container.textContent).not.toMatch(/[A-Za-z]/);
        // A capture, not a confirmation (D-44 / D-46): "पक्कं नाही" until the primary owner's own "पक्कं आहे".
        expect(screen.getByTestId('vr-not-confirmed-badge').textContent).toBe('पक्कं नाही');
        expect(screen.getByTestId('vr-confirm-basis').textContent).toBe('वाचा आणि पक्कं करा');
        // He told Sathi in writing ("लिहून सांगा"): it counts as a time he told it, as the design counts it.
        expect(screen.getByTestId('vr-count').textContent).toBe('आज पहिल्यांदा सांगितलं');
        await act(async () => { fireEvent.click(screen.getByTestId('vr-confirm')); });
        await waitFor(() => expect(screen.getByTestId('vr-confirm-done')).toBeTruthy());
        expect((await verifyRows())[0].payload).toMatchObject({ logId: NOW, decision: 'verify', reviewBasis: 'read' });
    });

    it('why-tiles: heading, the FIRST part open at once, his phrase highlighted, the fixed reason, a fold, and a tap dims the rest', () => {
        const said = 'छाटणी केली, बांधणी केली, खुडणी केली आणि दोन तास पाणी दिलं';
        const rec = log(NOW, {
            fullTranscript: said,
            cropActivities: [
                { id: 'c1', title: 'छाटणी', sourceText: 'छाटणी केली' },
                { id: 'c2', title: 'बांधणी', sourceText: 'बांधणी केली' },
                { id: 'c3', title: 'खुडणी', sourceText: 'खुडणी केली' },
            ],
            irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
            meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
        });
        mount(props({ history: [rec] }));
        expect(screen.getByTestId('vr-why-heading').textContent).toBe('श्रम साथीला हे का समजले?');
        const card = screen.getByTestId('vr-link-card'); // open before any tap: the first part he said
        expect(card.getAttribute('data-part')).toBe('crop');
        const cue = screen.getByTestId('vr-why-cue-crop-0');
        expect(cue.tagName).toBe('MARK');
        expect(cue.textContent).toBe('छाटणी केली'); // the AI's own sourceText, verified in his words
        expect(screen.getByTestId('vr-why-reason-crop-0').textContent).toBe('साथीला हे तुमच्या या शब्दांतून समजलं');
        expect(card.textContent).not.toContain('«'); // never the preview's keyword stand-in (reasons.ts)
        expect(screen.queryByTestId('vr-link-phrase-crop-2')).toBeNull();
        expect(screen.getByTestId('vr-why-more').textContent).toBe('आणखी १ दाखवा');
        fireEvent.click(screen.getByTestId('vr-why-more'));
        expect(screen.getByTestId('vr-link-phrase-crop-2').textContent).toContain('खुडणी केली');
        expect(screen.getByTestId('vr-why-more').textContent).toBe('कमी दाखवा');
        // Nothing dimmed until he taps; a tap keeps only that part bright in his words.
        const marks = () => [...screen.getByTestId('vr-words').querySelectorAll('mark')];
        expect(marks().every(m => m.getAttribute('data-dim') === 'no')).toBe(true);
        fireEvent.click(screen.getByTestId('vr-link-irrigation'));
        expect(screen.getByTestId('vr-link-card').getAttribute('data-part')).toBe('irrigation');
        expect(marks().filter(m => m.getAttribute('data-dim') === 'no').map(m => m.textContent)).toEqual(['दोन तास पाणी']);
    });

    it('products: one chip row, one spray box with HIS words and amounts as said — never computed water, never an identity', () => {
        const rec = log(NOW, {
            fullTranscript: 'पाचशे लिटर पाण्यात इथरेल आणि बाविस्तीन फवारलं',
            inputs: [{
                id: 'sp', method: 'Spray', sourceText: 'इथरेल आणि बाविस्तीन फवारलं', computedWaterVolume: 9999, carrierCapacity: 777,
                mix: [
                    { id: 'm1', productName: 'Ethrel', rawProductName: 'इथरेल', dose: 250, unit: 'ml' },
                    { id: 'm2', productName: 'Bavistin', rawProductName: 'बाविस्तीन', unit: 'g' },
                ],
            }],
            irrigation: [{ id: 'carrier', role: 'spray-carrier', waterVolumeLitres: 500, sourceText: 'पाचशे लिटर पाण्यात' }],
            meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
        });
        const { container } = mount(props({ history: [rec] }));
        const chips = within(screen.getByTestId('vr-added-products')).getAllByTestId('vr-product-chip').map(c => c.textContent);
        expect(chips).toEqual(['इथरेल · 250 मिली', 'बाविस्तीन']); // no amount said for the second: none shown
        expect(screen.queryByTestId('vr-added-sp')).toBeNull(); // not a second, per-item row
        const box = screen.getByTestId('vr-product-box-sp'); // the day's औषध / खत row is open: this recording touched it
        expect(box.getAttribute('data-kind')).toBe('spray');
        expect(box.textContent).toContain('फवारणी');
        expect(within(box).getByTestId('vr-product-water').textContent).toBe('पाणी: 500 लिटर');
        expect(within(box).getAllByTestId('vr-product-row')).toHaveLength(2);
        expect(container.textContent).not.toMatch(/9999|777/);
        expect(container.textContent).not.toMatch(/ओळख|कदाचित|मात्रा सांगितली नाही/);
        expect(container.textContent).not.toMatch(/[A-Za-z]/); // Marathi mode: the units in Marathi, no English labels
    });
});
