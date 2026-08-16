// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (voice-archive-failure-landing)
 * Founder ruling D9 (2026-08-14).
 *
 * THE CALLER HALF. `AiJobWorker` used to call the retained-tier archive and
 * throw the result away:
 *
 *     await archiveToRetainedTierIfConsented(clipId);
 *
 * under a comment saying errors were swallowed inside that function, while that
 * function's comment said observability was "owned by the caller (AiJobWorker
 * hook)". Both halves pointed at the other and neither reported anything.
 *
 * These tests pin the two things the caller is responsible for:
 *   1. it does not discard the outcome — the JOB RECORD distinguishes
 *      "parsed and archived" from "parsed, archive failed";
 *   2. a failed archive still does not break the parse, because the parse
 *      genuinely succeeded and re-running the job would re-run a paid AI call
 *      and re-upload the audio.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { archiveMock, parseVoiceMock, parseTextMock } = vi.hoisted(() => ({
    archiveMock: vi.fn(),
    parseVoiceMock: vi.fn(),
    // REVIEW B2 — `parseTextLog` WAS MISSING FROM THIS FAKE, and its absence was
    // holding up a test. `D9_a_text_job_never_reaches_the_archive_at_all` passed
    // because the text job CRASHED on `agriSyncClient.parseTextLog is not a
    // function` before ever reaching the archive check — so the assertion was
    // measuring the fake's gaps, not the safeguard. Deleting the safeguard from
    // production left it green.
    parseTextMock: vi.fn(),
}));

vi.mock('../../voice/VoiceClipRetention', () => ({
    archiveToRetainedTierIfConsented: archiveMock,
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { parseVoiceLog: parseVoiceMock, parseTextLog: parseTextMock } };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'u', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { resetDatabase, getDatabase } from '../../storage/DexieDatabase';
import { AiJobWorker } from '../AiJobWorker';

const CLIP_ID = 'c1111111-1111-4111-8111-111111111111';
const FARM_ID = 'f2222222-2222-4222-8222-222222222222';

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedVoiceJob(): Promise<number> {
    return getDatabase().pendingAiJobs.add({
        operationType: 'voice_parse',
        inputBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
        inputMimeType: 'audio/webm',
        context: { farmId: FARM_ID, idempotencyKey: CLIP_ID, operation: 'voice' },
        status: 'pending',
        createdAt: '2026-08-15T09:00:00.000Z',
        updatedAt: '2026-08-15T09:00:00.000Z',
        retryCount: 0,
    } as never);
}

async function job(id: number) {
    return getDatabase().pendingAiJobs.get(id) as Promise<Record<string, unknown> | undefined>;
}

describe('AiJobWorker — the archive outcome is no longer discarded (D9)', () => {
    beforeEach(async () => {
        await freshDb();
        archiveMock.mockReset();
        parseVoiceMock.mockReset();
        parseTextMock.mockReset();
        parseVoiceMock.mockResolvedValue({ parsed: true });
        parseTextMock.mockResolvedValue({ parsed: true });
    });

    it('D9_a_failed_archive_is_recorded_on_the_job_so_completed_stops_over_claiming', async () => {
        const id = await seedVoiceJob();
        archiveMock.mockResolvedValue({
            status: 'failed', clipId: CLIP_ID, reason: 'persist_failed',
            message: 'Network Error', attempts: 2,
        });

        await AiJobWorker.run();

        const row = await job(id);
        // The parse really did succeed, so the job really is completed...
        expect(row?.status).toBe('completed');
        expect(row?.result).toBeDefined();
        // ...but the record no longer claims the archive happened. Before the
        // fix these two were indistinguishable anywhere in the system.
        expect(row?.retainedArchive).toMatchObject({
            status: 'failed', reason: 'persist_failed', attempts: 2,
        });
    });

    it('D9_a_successful_archive_is_recorded_as_archived', async () => {
        const id = await seedVoiceJob();
        archiveMock.mockResolvedValue({
            status: 'archived', clipId: CLIP_ID, retainedKey: 'server-clip-1', attempts: 1,
        });

        await AiJobWorker.run();

        const row = await job(id);
        expect(row?.status).toBe('completed');
        expect(row?.retainedArchive).toMatchObject({ status: 'archived', attempts: 1 });
        // No `reason` on success — there is nothing to explain.
        expect((row?.retainedArchive as Record<string, unknown>).reason).toBeUndefined();
    });

    it('D9_a_farmer_who_never_consented_records_a_skip_not_a_failure', async () => {
        const id = await seedVoiceJob();
        archiveMock.mockResolvedValue({
            status: 'skipped', clipId: CLIP_ID, reason: 'consent_not_granted',
        });

        await AiJobWorker.run();

        expect((await job(id))?.retainedArchive).toMatchObject({
            status: 'skipped', reason: 'consent_not_granted',
        });
    });

    it('D9_a_failed_archive_does_not_fail_the_parse_job', async () => {
        // Deliberate: the parse succeeded and cost money. Failing the job would
        // re-run it, re-uploading the audio and re-paying for the parse — worse
        // than the defect being fixed.
        const id = await seedVoiceJob();
        archiveMock.mockResolvedValue({
            status: 'failed', clipId: CLIP_ID, reason: 'persist_failed',
            message: 'boom', attempts: 2,
        });

        await AiJobWorker.run();

        const row = await job(id);
        expect(row?.status).toBe('completed');
        expect(row?.lastError).toBeUndefined();
        expect(row?.retryCount).toBe(0);
    });

    it('D9_a_text_job_never_reaches_the_archive_at_all', async () => {
        // Only voice clips have bytes to archive; a text parse must not be
        // recorded as an archive skip, which would be noise about nothing.
        //
        // REVIEW B2 — this test must fail for the RIGHT reason. It asserts the
        // job COMPLETED below, which is what proves the text parse actually ran
        // and the archive was skipped by the safeguard, rather than the job
        // dying on a missing fake before the check was ever reached.
        await getDatabase().pendingAiJobs.add({
            operationType: 'voice_parse',
            context: {
                farmId: FARM_ID, idempotencyKey: CLIP_ID,
                operation: 'text', textTranscript: 'पाणी दिले',
            },
            status: 'pending',
            createdAt: '2026-08-15T09:00:00.000Z',
            updatedAt: '2026-08-15T09:00:00.000Z',
            retryCount: 0,
        } as never);

        await AiJobWorker.run();

        // The parse genuinely ran and the job genuinely completed...
        expect(parseTextMock).toHaveBeenCalledTimes(1);
        const row = await getDatabase().pendingAiJobs.toArray();
        expect(row[0].status).toBe('completed');
        // ...and only THEN does "the archive was not called" mean the safeguard
        // worked rather than that the job never got there.
        expect(archiveMock).not.toHaveBeenCalled();
    });
});
