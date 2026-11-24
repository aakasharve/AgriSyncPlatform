// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (P4) - an ONLINE server/line failure keeps his voice as a pending job (same
 * rules as offline) and returns the "kept" code; a refusal, a correction of a saved entry or a refused day keeps
 * nothing. The audio is never deleted. Real Dexie (fake-indexeddb).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ parseTextLog: vi.fn(), parseVoiceLog: vi.fn() }));

vi.mock('../BackendAiClient.helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../BackendAiClient.helpers')>()),
    resolveFarmIdFromCache: async () => 'farm-1',
    resolveUserIdFromSession: () => 'user-1',
}));
vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: { parseTextLog: h.parseTextLog, parseVoiceLog: h.parseVoiceLog },
}));

import { BackendAiClient } from '../BackendAiClient';
import { setOfflineVoiceDayProvider, setOfflineVoiceQueueGate } from '../offlineVoiceQueue';
import { ONLINE_KEPT_MESSAGE } from '../../voice/keptForLater';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const SCOPE: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [] } as unknown as FarmerProfile;
const AUDIO = { type: 'audio', data: 'AQID', mimeType: 'audio/webm', inputRawDurationMs: 5_000, idempotencyKey: 'clip-1' } as const;

function httpError(status?: number, data?: unknown, message = 'failed'): Error {
    const e = new Error(message) as Error & Record<string, unknown>;
    e.isAxiosError = true;
    if (status === undefined) e.request = {}; else e.response = { status, data };
    return e;
}
const run = (input: Parameters<BackendAiClient['parseInput']>[0]) =>
    new BackendAiClient().parseInput(input, SCOPE, [] as CropProfile[], PROFILE);

describe('P4 - a server failure never loses the voice', () => {
    let online: ReturnType<typeof vi.spyOn>;
    let context: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        context = vi.spyOn(BackendAiClient.prototype as unknown as { buildContext: () => unknown }, 'buildContext').mockReturnValue({});
        h.parseVoiceLog.mockReset();
        h.parseTextLog.mockReset();
    });
    afterEach(() => {
        online.mockRestore(); context.mockRestore(); vi.restoreAllMocks();
        setOfflineVoiceQueueGate(() => true); setOfflineVoiceDayProvider(() => undefined);
    });

    it('an online 503 keeps the audio, queues exactly one job, returns the kept code', async () => {
        h.parseVoiceLog.mockRejectedValue(httpError(503));
        const r = await run(AUDIO);
        expect(r).toEqual({ success: false, error: ONLINE_KEPT_MESSAGE });
        const jobs = await getDatabase().pendingAiJobs.toArray();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].inputBlob).toBeTruthy();
        expect(jobs[0].context.idempotencyKey).toBe('clip-1'); // same key as the first try
        const clip = await getDatabase().voiceClips.get('clip-1');
        expect(clip?.status).toBe('queued');
        expect(clip?.pendingAiJobId).toBe(jobs[0].id);
        expect(clip?.localBlob).toBeTruthy();
        expect(clip?.lastError).toBeUndefined();
    });

    it('the clip is never written failed on a kept note (no failed window without a job)', async () => {
        h.parseVoiceLog.mockRejectedValue(httpError(503));
        const puts: string[] = [];
        const proto = BackendAiClient.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const orig = proto.persistProcessingVoiceClip;
        vi.spyOn(proto, 'persistProcessingVoiceClip').mockImplementation(function (this: unknown, ...a: unknown[]) {
            puts.push(String(a[3]));
            return orig.apply(this, a);
        });
        await run(AUDIO);
        expect(puts).toEqual(['parsing', 'queued']);
    });

    it.each([
        ['no response', httpError(undefined)],
        ['429', httpError(429)],
        ['400 AiParsingFailed', httpError(400, { error: 'ShramSafal.AiParsingFailed', message: 'x' })],
    ])('%s keeps it too', async (_n, err) => {
        h.parseVoiceLog.mockRejectedValue(err);
        expect(await run(AUDIO)).toEqual({ success: false, error: ONLINE_KEPT_MESSAGE });
        expect(await getDatabase().pendingAiJobs.count()).toBe(1);
    });

    it.each([
        ['400 InvalidCommand', httpError(400, { error: 'ShramSafal.InvalidCommand', message: 'bad' }, 'bad')],
        ['403', httpError(403)],
        ['413', httpError(413)],
        ['422', httpError(422)],
        ['400 input-refused', httpError(400, { error: 'ShramSafal.AiParsingFailed', message: '[input-refused] no' }, '[input-refused] no')],
    ])('%s does not queue; the original error is returned; clip failed', async (_n, err) => {
        h.parseVoiceLog.mockRejectedValue(err);
        const r = await run(AUDIO);
        expect(r.success).toBe(false);
        expect(r.error).toBe(err.message);
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
        expect((await getDatabase().voiceClips.get('clip-1'))?.status).toBe('failed');
    });

    it('a correction of a saved entry (gate closed) + 503: no job, original error, clip failed', async () => {
        setOfflineVoiceQueueGate(() => false);
        h.parseVoiceLog.mockRejectedValue(httpError(503, undefined, 'unavailable'));
        const r = await run(AUDIO);
        expect(r).toEqual({ success: false, error: 'unavailable' });
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
        expect((await getDatabase().voiceClips.get('clip-1'))?.status).toBe('failed');
    });

    it('a chosen day after today + 503: no job', async () => {
        setOfflineVoiceDayProvider(() => '2099-01-01');
        h.parseVoiceLog.mockRejectedValue(httpError(503, undefined, 'unavailable'));
        const r = await run(AUDIO);
        expect(r).toEqual({ success: false, error: 'unavailable' });
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
        expect((await getDatabase().voiceClips.get('clip-1'))?.status).toBe('failed');
    });

    it('typed words + 503: one text job, same code', async () => {
        h.parseTextLog.mockRejectedValue(httpError(503));
        expect(await run({ type: 'text', content: 'water given' })).toEqual({ success: false, error: ONLINE_KEPT_MESSAGE });
        const jobs = await getDatabase().pendingAiJobs.toArray();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].context.operation).toBe('text');
    });

    it('keeping it fails too (disk full): the original error is shown, no job, the clip is not left parsing', async () => {
        h.parseVoiceLog.mockRejectedValue(httpError(503, undefined, 'unavailable'));
        vi.spyOn(getDatabase().pendingAiJobs, 'add').mockRejectedValue(new Error('disk full'));
        const r = await run(AUDIO);
        expect(r).toEqual({ success: false, error: 'unavailable' });
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
        expect((await getDatabase().voiceClips.get('clip-1'))?.status).toBe('failed');
    });
});
