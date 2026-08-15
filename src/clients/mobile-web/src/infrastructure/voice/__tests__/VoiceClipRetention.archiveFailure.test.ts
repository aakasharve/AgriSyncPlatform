// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (voice-archive-failure-landing)
 * Founder ruling D9 (2026-08-14).
 *
 * D9 promises a consenting farmer he can listen back to any day, FOREVER.
 * `archiveToRetainedTierIfConsented` is what buys that: it lifts the clip out of
 * the local 30-day processing journal into the permanent tier.
 *
 * When it failed it returned a bare `false`, the caller discarded the value, the
 * job ticked green, and the only trace was a `console.warn` inside a WebView on
 * a farmer's Android. Thirty days later the clip left the Voice Diary and
 * nothing anywhere said why.
 *
 * NOT DATA DESTRUCTION — `purgeExpiredProcessingVoiceClips` is a hard-coded
 * no-op under D9 and the bytes stay on the phone. It is a broken promise the
 * farmer cannot tell apart from data destruction, which is why the fix is
 * about making the break visible rather than about recovering bytes.
 *
 * TWO HALVES, AND THE SECOND IS THE TRAP. The failure has to land somewhere a
 * human reaches. The ordinary path — the overwhelming majority of clips — has
 * to stay completely silent, or the signal is worthless.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getConsentMock, persistMock, emitClientErrorMock } = vi.hoisted(() => ({
    getConsentMock: vi.fn(),
    persistMock: vi.fn(),
    emitClientErrorMock: vi.fn(),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { getConsent: getConsentMock } };
});

vi.mock('../../voiceDiary/voiceDiaryApiClient', () => ({
    persistRetainedVoiceClip: persistMock,
}));

// THE VERIFIED SINK. `emitClientError` -> eventBus -> db.analyticsOutbox ->
// POST /analytics/ingest, rendered on AdminOpsPage, already wired to
// window.onerror at index.tsx:60. Mocked here to observe the call; its delivery
// path is owned by AnalyticsEventBus.spec.ts.
vi.mock('../../../core/telemetry/eventEmitters', () => ({
    emitClientError: emitClientErrorMock,
}));

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { archiveToRetainedTierIfConsented } from '../VoiceClipRetention';

const CLIP_ID = 'c1111111-1111-4111-8111-111111111111';
const FARM_ID = 'f2222222-2222-4222-8222-222222222222';

/** A sealed v18+ row: ciphertext longer than the 16-byte AES-GCM tag. */
function sealedRow(overrides: Record<string, unknown> = {}) {
    return {
        id: CLIP_ID,
        farmId: FARM_ID,
        recordedAtUtc: '2026-08-15T09:00:00.000Z',
        durationMs: 4000,
        mimeType: 'audio/webm',
        sizeBytes: 48,
        ciphertext: new Uint8Array(48).fill(7),
        iv: new Uint8Array(12).fill(3),
        wrappedDekId: 'dek-1',
        status: 'parsed',
        retentionPolicy: 'processing_30d',
        expiresAtUtc: '2026-09-14T09:00:00.000Z',
        createdAt: '2026-08-15T09:00:00.000Z',
        updatedAt: '2026-08-15T09:00:00.000Z',
        ...overrides,
    };
}

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function clipRow() {
    return getDatabase().voiceClips.get(CLIP_ID) as Promise<Record<string, unknown> | undefined>;
}

describe('archiveToRetainedTierIfConsented — the failure has to land (D9)', () => {
    beforeEach(async () => {
        await freshDb();
        getConsentMock.mockReset();
        persistMock.mockReset();
        emitClientErrorMock.mockReset();
        getConsentMock.mockResolvedValue({ fullHistoryJournal: true });
    });

    it('D9_a_failed_upload_reaches_the_telemetry_sink_a_human_can_read', async () => {
        await getDatabase().voiceClips.put(sealedRow() as never);
        persistMock.mockRejectedValue(new Error('Network Error'));

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome.status).toBe('failed');
        // THE ASSERTION THIS FILE EXISTS FOR. Before the fix this was 0 and the
        // only trace was a console.warn nobody can read in production.
        expect(emitClientErrorMock).toHaveBeenCalledTimes(1);
        const payload = emitClientErrorMock.mock.calls[0][0] as { message: string; farmId?: string };
        expect(payload.message).toContain('retained archive FAILED');
        expect(payload.message).toContain('persist_failed');
        expect(payload.message).toContain(CLIP_ID);
        expect(payload.message).toContain('Network Error');
        expect(payload.farmId).toBe(FARM_ID);
    });

    it('D9_the_failure_is_also_recorded_durably_on_the_clip_so_someone_can_act_later', async () => {
        await getDatabase().voiceClips.put(sealedRow() as never);
        persistMock.mockRejectedValue(new Error('503 Service Unavailable'));

        await archiveToRetainedTierIfConsented(CLIP_ID);

        const row = await clipRow();
        // Telemetry tells a human today; this is what lets anyone act tomorrow,
        // and it is the query a future re-attempt sweep would run.
        expect(row?.retainedArchiveError).toContain('persist_failed');
        expect(row?.retainedArchiveError).toContain('503');
        expect(row?.retainedArchiveAttempts).toBe(2);
        expect(row?.retainedArchiveLastAttemptAtUtc).toBeTruthy();
        // And the clip is NOT marked archived, because it is not.
        expect(row?.s3RetainedKey).toBeUndefined();
    });

    it('D9_the_upload_is_retried_exactly_once_then_stops', async () => {
        await getDatabase().voiceClips.put(sealedRow() as never);
        persistMock.mockRejectedValue(new Error('Network Error'));

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        // Bounded by construction, not by an error classifier. The backend is
        // idempotent on clipId (S3RetainedBlobStore.PersistAsync) so a second
        // attempt cannot double-write; a permanently broken clip costs two
        // requests once, never a loop.
        expect(persistMock).toHaveBeenCalledTimes(2);
        expect(outcome.status === 'failed' && outcome.attempts).toBe(2);
    });

    it('D9_a_transient_first_failure_is_recovered_by_the_retry_and_stays_silent', async () => {
        await getDatabase().voiceClips.put(sealedRow() as never);
        persistMock
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockResolvedValueOnce({ clipId: 'server-clip-1' });

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome).toEqual({
            status: 'archived', clipId: CLIP_ID, retainedKey: 'server-clip-1', attempts: 2,
        });
        // Recovered means recovered: no alarm, and no stale failure left behind.
        expect(emitClientErrorMock).not.toHaveBeenCalled();
        const row = await clipRow();
        expect(row?.s3RetainedKey).toBe('server-clip-1');
        expect(row?.retainedArchiveError).toBeUndefined();
    });

    it('D9_consent_granted_but_the_clip_row_is_gone_is_a_failure_not_a_shrug', async () => {
        // No row seeded. He consented and the clip will never be archived; the
        // old code returned the same `false` as "he never consented".
        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome.status).toBe('failed');
        expect(outcome.status === 'failed' && outcome.reason).toBe('clip_row_missing');
        expect(emitClientErrorMock).toHaveBeenCalledTimes(1);
    });

    it('D9_an_unsealed_legacy_row_is_a_failure_because_it_will_never_be_archived', async () => {
        await getDatabase().voiceClips.put(
            sealedRow({ ciphertext: undefined, iv: undefined, wrappedDekId: undefined }) as never,
        );

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome.status === 'failed' && outcome.reason).toBe('unsealed_legacy_row');
        expect(emitClientErrorMock).toHaveBeenCalledTimes(1);
        expect(persistMock).not.toHaveBeenCalled();
    });

    it('D9_a_ciphertext_shorter_than_the_auth_tag_is_a_failure_and_never_hits_the_wire', async () => {
        await getDatabase().voiceClips.put(sealedRow({ ciphertext: new Uint8Array(8) }) as never);

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome.status === 'failed' && outcome.reason).toBe('ciphertext_malformed');
        expect(emitClientErrorMock).toHaveBeenCalledTimes(1);
        expect(persistMock).not.toHaveBeenCalled();
    });
});

describe('archiveToRetainedTierIfConsented — the ordinary path stays silent', () => {
    beforeEach(async () => {
        await freshDb();
        getConsentMock.mockReset();
        persistMock.mockReset();
        emitClientErrorMock.mockReset();
    });

    it('SILENT_a_successful_archive_emits_nothing_and_writes_no_failure_state', async () => {
        // THE TRAP IN THIS FIX. Almost every clip lands here. If this path
        // reports anything, the failures above are buried and the sink is
        // useless.
        getConsentMock.mockResolvedValue({ fullHistoryJournal: true });
        await getDatabase().voiceClips.put(sealedRow() as never);
        persistMock.mockResolvedValue({ clipId: 'server-clip-1' });

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome).toEqual({
            status: 'archived', clipId: CLIP_ID, retainedKey: 'server-clip-1', attempts: 1,
        });
        expect(emitClientErrorMock).not.toHaveBeenCalled();
        expect(persistMock).toHaveBeenCalledTimes(1);
        const row = await clipRow();
        expect(row?.s3RetainedKey).toBe('server-clip-1');
        expect(row?.retainedArchiveError).toBeUndefined();
    });

    it('SILENT_a_farmer_who_never_consented_emits_nothing_and_never_hits_the_wire', async () => {
        getConsentMock.mockResolvedValue({ fullHistoryJournal: false });
        await getDatabase().voiceClips.put(sealedRow() as never);

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        // No promise was made, so there is nothing to break and nothing to say.
        expect(outcome).toEqual({ status: 'skipped', clipId: CLIP_ID, reason: 'consent_not_granted' });
        expect(emitClientErrorMock).not.toHaveBeenCalled();
        expect(persistMock).not.toHaveBeenCalled();
    });

    it('SILENT_a_clip_already_archived_emits_nothing_and_costs_no_round_trip', async () => {
        getConsentMock.mockResolvedValue({ fullHistoryJournal: true });
        await getDatabase().voiceClips.put(sealedRow({ s3RetainedKey: 'already-there' }) as never);

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome).toEqual({ status: 'skipped', clipId: CLIP_ID, reason: 'already_archived' });
        expect(emitClientErrorMock).not.toHaveBeenCalled();
        expect(persistMock).not.toHaveBeenCalled();
    });

    it('SILENT_an_unreadable_consent_check_is_recorded_but_not_reported', async () => {
        // Deliberate, and stated in the report as a residual: this fires on
        // ordinary flaky connectivity, the clip is untouched on the phone, and a
        // report per flaky read would bury the failures that matter.
        getConsentMock.mockRejectedValue(new Error('offline'));
        await getDatabase().voiceClips.put(sealedRow() as never);

        const outcome = await archiveToRetainedTierIfConsented(CLIP_ID);

        expect(outcome).toEqual({ status: 'skipped', clipId: CLIP_ID, reason: 'consent_unknown' });
        expect(emitClientErrorMock).not.toHaveBeenCalled();
        // Recorded, so it is not invisible — just not an alarm.
        expect((await clipRow())?.retainedArchiveError).toContain('consent_unknown');
    });
});
