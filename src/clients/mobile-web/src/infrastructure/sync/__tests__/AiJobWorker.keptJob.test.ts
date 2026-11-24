// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (P4) — a recording kept after the SERVER failed while the phone was online is a
 * pending AI job exactly like one kept offline, and the worker that drains it must:
 *   - send it with the SAME idempotency key (the server answers a repeated key with the stored answer: no second charge,
 *     no second log) and parse it ONCE — a finished job is never picked up again, and two overlapping runs take it once;
 *   - land its answer where offline notes land (`listUnreviewedAiResults` → the आवाज नोंदी "समजलं" row), exactly one row;
 *   - never delete his sound before a parsed answer exists: a failed try keeps the job's audio AND the clip's audio, the
 *     job waits for its next try, and one the queue finally gives up on is shown as "stuck" with its sound kept.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parseVoiceMock, archiveMock } = vi.hoisted(() => ({ parseVoiceMock: vi.fn(), archiveMock: vi.fn() }));

vi.mock('../../voice/VoiceClipRetention', () => ({ archiveToRetainedTierIfConsented: archiveMock }));
vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { parseVoiceLog: parseVoiceMock, parseTextLog: vi.fn() } };
});
vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'u', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { resetDatabase, getDatabase, type PendingAiJobRecord, type VoiceClipCacheRecord } from '../../storage/DexieDatabase';
import { AiJobWorker } from '../AiJobWorker';
import { listUnreviewedAiResults } from '../PendingAiResultsReader';
import { listWaitingVoiceNotes } from '../waitingVoiceNotes';

const KEY = 'c1111111-1111-4111-8111-111111111111';
const FARM = 'f2222222-2222-4222-8222-222222222222';
const ANSWER = {
    success: true,
    parsedLog: { summary: '', dayOutcome: 'WORK_RECORDED', inputs: [], cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [], missingSegments: [] },
};
const AUDIO = new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'audio/webm' });

async function freshDb() {
    const db = getDatabase();
    try { await db.delete(); } catch { /* first run */ }
    await resetDatabase();
}

/** What the online-failure path leaves behind (the same rows `enqueueOfflineVoiceJob` writes): a pending job + a queued clip. */
async function keptAfterServerFailure(): Promise<number> {
    const db = getDatabase();
    const id = await db.pendingAiJobs.add({
        operationType: 'voice_parse',
        inputBlob: AUDIO,
        inputMimeType: 'audio/webm',
        context: { farmId: FARM, userId: 'u', operation: 'voice', idempotencyKey: KEY, requestPayloadHash: 'h', parseContext: {}, recordedAtUtc: '2026-11-24T08:00:00.000Z' },
        status: 'pending',
        createdAt: '2026-11-24T08:00:01.000Z',
        updatedAt: '2026-11-24T08:00:01.000Z',
        retryCount: 0,
    } as never);
    await db.voiceClips.put({
        id: KEY, farmId: FARM, pendingAiJobId: id, recordedAtUtc: '2026-11-24T08:00:00.000Z', durationMs: 30_000, mimeType: 'audio/webm',
        sizeBytes: AUDIO.size, localBlob: AUDIO, status: 'queued', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-12-24T08:00:00.000Z',
        createdAt: '2026-11-24T08:00:01.000Z', updatedAt: '2026-11-24T08:00:01.000Z',
    } as never);
    return id;
}

const jobRow = async (id: number): Promise<PendingAiJobRecord> => (await getDatabase().pendingAiJobs.get(id))!;
const clipRow = async (): Promise<VoiceClipCacheRecord | undefined> => getDatabase().voiceClips.get(KEY);
const serverDown = () => Object.assign(new Error('Request failed with status code 503'), { isAxiosError: true, response: { status: 503 } });

describe('AiJobWorker — a note kept after a server failure', () => {
    beforeEach(async () => {
        await freshDb();
        parseVoiceMock.mockReset();
        archiveMock.mockReset().mockResolvedValue({ status: 'archived', clipId: KEY, attempts: 1 });
    });

    it('is sent with the same idempotency key, parsed once, and lands where offline notes land (one row, no duplicate)', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockResolvedValue(ANSWER);

        await AiJobWorker.run();

        expect(parseVoiceMock).toHaveBeenCalledTimes(1);
        const [blob, mime, , farmId, options] = parseVoiceMock.mock.calls[0];
        expect(blob).toBeDefined(); // (fake-indexeddb hands a jsdom Blob back as `{}`: its presence is what counts)
        expect(mime).toBe('audio/webm');
        expect(farmId).toBe(FARM);
        expect(options).toMatchObject({ idempotencyKey: KEY, requestPayloadHash: 'h', recordedAtUtc: '2026-11-24T08:00:00.000Z' });

        const row = await jobRow(id);
        expect(row.status).toBe('completed');
        const waiting = await listUnreviewedAiResults();
        expect(waiting.map(w => w.id)).toEqual([id]);                       // one result, on the reviewing surface
        const notes = await listWaitingVoiceNotes();
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ jobId: id, state: 'understood' }); // the आवाज नोंदी "समजलं" row
        expect((await clipRow())?.status).toBe('parsed');
    });

    it('a drained job does not parse twice: a finished job is not picked up again', async () => {
        await keptAfterServerFailure();
        parseVoiceMock.mockResolvedValue(ANSWER);

        await AiJobWorker.run();
        await AiJobWorker.run();
        await AiJobWorker.run();

        expect(parseVoiceMock).toHaveBeenCalledTimes(1);
        expect(await listUnreviewedAiResults()).toHaveLength(1);
    });

    it('two runs at once take the job once (the re-entrancy guard)', async () => {
        await keptAfterServerFailure();
        let release!: () => void;
        parseVoiceMock.mockImplementation(() => new Promise(resolve => { release = () => resolve(ANSWER); }));

        const first = AiJobWorker.run();
        await new Promise(r => setTimeout(r, 20));
        const second = AiJobWorker.run();
        await new Promise(r => setTimeout(r, 20));
        release();
        await Promise.all([first, second]);

        expect(parseVoiceMock).toHaveBeenCalledTimes(1);
        expect(await listUnreviewedAiResults()).toHaveLength(1);
    });

    it('a failed try deletes nothing: the job keeps its audio, the clip keeps its audio, and the job waits for its next try', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValue(serverDown());

        await AiJobWorker.run();

        const row = await jobRow(id);
        expect(row.status).toBe('failed');                // not `completed`, not given up
        expect(row.retryCount).toBe(1);
        expect(row.inputBlob).toBeDefined();               // his sound is still on the job
        expect(row.nextRetryAfterMs).toBeGreaterThan(Date.now());
        const clip = await clipRow();
        expect(clip?.localBlob).toBeDefined();             // and on the clip: nothing deleted before a parsed result exists
        expect(await listUnreviewedAiResults()).toHaveLength(0); // and nothing claims he was understood
        expect((await listWaitingVoiceNotes())[0].state).toBe('pending'); // still counted, still waiting: "अजून समजलं नाही"
    });

    it('a try that fails and a later try that works leave ONE result and one parse that counted', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValueOnce(serverDown()).mockResolvedValue(ANSWER);

        await AiJobWorker.run();
        await getDatabase().pendingAiJobs.update(id, { nextRetryAfterMs: undefined }); // the backoff has passed
        await AiJobWorker.run();

        expect(parseVoiceMock).toHaveBeenCalledTimes(2);
        expect(parseVoiceMock.mock.calls[0][4]).toMatchObject({ idempotencyKey: KEY });
        expect(parseVoiceMock.mock.calls[1][4]).toMatchObject({ idempotencyKey: KEY }); // the same request: the server answers the stored one
        expect(await listUnreviewedAiResults()).toHaveLength(1);
        expect((await jobRow(id)).status).toBe('completed');
    });

    it('a server failure keeps trying well past the usual five tries, each wait longer, and is never a doom loop', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValue(serverDown());
        const waits: number[] = [];

        for (let attempt = 0; attempt < 10; attempt++) {
            await AiJobWorker.run();
            const row = await jobRow(id);
            expect(row.status).toBe('failed');                  // still waiting for its next try, never given up
            waits.push((row.nextRetryAfterMs ?? 0) - Date.now());
            await getDatabase().pendingAiJobs.update(id, { nextRetryAfterMs: undefined });
        }

        expect(parseVoiceMock).toHaveBeenCalledTimes(10);
        expect(waits[3]).toBeGreaterThan(waits[0]);             // the waits grow…
        expect(Math.max(...waits)).toBeLessThanOrEqual(5 * 60 * 1000 + 1000); // …to five minutes at most
        expect(Math.max(...waits)).toBeGreaterThan(60 * 1000);  // and past the old one-minute ceiling
        expect(await listUnreviewedAiResults()).toHaveLength(0);
        expect((await listWaitingVoiceNotes())[0].state).toBe('pending'); // "अजून समजलं नाही", not "stuck"
    });

    it('and when the server comes back it is understood once, with the same key', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValue(serverDown());
        for (let attempt = 0; attempt < 8; attempt++) {
            await AiJobWorker.run();
            await getDatabase().pendingAiJobs.update(id, { nextRetryAfterMs: undefined });
        }
        parseVoiceMock.mockReset().mockResolvedValue(ANSWER);

        await AiJobWorker.run();

        expect(parseVoiceMock).toHaveBeenCalledTimes(1);
        expect(parseVoiceMock.mock.calls[0][4]).toMatchObject({ idempotencyKey: KEY });
        expect((await jobRow(id)).status).toBe('completed');
        expect((await listWaitingVoiceNotes())[0].state).toBe('understood');
        expect(await listUnreviewedAiResults()).toHaveLength(1);
    });

    it('a note the server never takes in an hour and a half is "stuck", not lost: his sound is kept and one tap puts it back', async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValue(serverDown());

        for (let attempt = 0; attempt < 24; attempt++) {
            await AiJobWorker.run();
            await getDatabase().pendingAiJobs.update(id, { nextRetryAfterMs: undefined });
        }

        const row = await jobRow(id);
        expect(row.status).toBe('failed_permanent');
        expect(row.inputBlob).toBeDefined();
        expect((await clipRow())?.localBlob).toBeDefined();
        const [note] = await listWaitingVoiceNotes();
        expect(note).toMatchObject({ state: 'stuck', why: 'notSent' }); // "पुन्हा प्रयत्न करा", never "lost"
    });

    it("anything else that fails (not the server or the line) still gives up after the usual five tries, as before", async () => {
        const id = await keptAfterServerFailure();
        parseVoiceMock.mockRejectedValue(new Error('Unexpected data format'));

        for (let attempt = 0; attempt < 5; attempt++) {
            await AiJobWorker.run();
            await getDatabase().pendingAiJobs.update(id, { nextRetryAfterMs: undefined });
        }

        expect((await jobRow(id)).status).toBe('failed_permanent');
    });
});
