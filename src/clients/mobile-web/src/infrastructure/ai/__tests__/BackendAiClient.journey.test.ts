// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 1) — the parse SAYS "आवाज जतन केला" to the v2 step list only once the recording is
 * really written on this phone (the 'parsing' clip row), and "तुम्ही लिहिलेलं मिळालं" when typed words are sent. Offline
 * (the job is queued for later) this path says nothing. Display only: what is sent is unchanged.
 */
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
import { readVoiceJourney, resetVoiceJourneyForTests } from '../../voice/voiceJourneySignal';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const SCOPE: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [], motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;
const ANSWER = { parsedLog: { summary: '', dayOutcome: 'WORK_RECORDED', inputs: [], cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [], missingSegments: [] }, confidence: 0.9 };
const proto = BackendAiClient.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
const MATERIAL = {
    audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), mimeType: 'audio/webm', idempotencyKey: 'k', requestPayloadHash: 'h',
    inputRawDurationMs: 46_200, inputSpeechDurationMs: 30_000,
};

describe('Task 1 — "kept" is said after the clip is written on the phone', () => {
    let online: ReturnType<typeof vi.spyOn>;
    let context: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        resetVoiceJourneyForTests();
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        context = vi.spyOn(proto, 'buildContext' as never).mockReturnValue({} as never);
        h.parseTextLog.mockReset().mockResolvedValue(ANSWER);
        h.parseVoiceLog.mockReset().mockResolvedValue(ANSWER);
    });
    afterEach(() => { online.mockRestore(); context.mockRestore(); vi.restoreAllMocks(); resetVoiceJourneyForTests(); });

    it('an online recording: kept (audio, its duration) only once the parsing clip row is written', async () => {
        let release!: () => void;
        const written = new Promise<void>(r => { release = r; });
        const keptAtWrite: Array<string | undefined> = [];
        vi.spyOn(proto, 'resolveVoiceUploadMaterial').mockResolvedValue(MATERIAL);
        vi.spyOn(proto, 'persistProcessingVoiceClip').mockImplementation(async (...args: unknown[]) => {
            keptAtWrite.push(readVoiceJourney()?.input);
            if (args[3] === 'parsing') await written;
        });

        const run = new BackendAiClient().parseInput({ type: 'audio', data: 'AQID', mimeType: 'audio/webm' }, SCOPE, [] as CropProfile[], PROFILE);
        await new Promise(r => setTimeout(r, 0));
        expect(readVoiceJourney()).toBeNull(); // the clip write has not finished: nothing said yet
        release();
        const result = await run;

        expect(result.success).toBe(true);
        expect(readVoiceJourney()).toMatchObject({ input: 'audio', durationMs: 46_200 });
        expect(readVoiceJourney()?.keptAt).toEqual(expect.any(Number));
        expect(keptAtWrite[0]).toBeUndefined();
    });

    it('typed words: kept (text), sent as before', async () => {
        const result = await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, SCOPE, [] as CropProfile[], PROFILE);
        expect(result.success).toBe(true);
        expect(readVoiceJourney()).toMatchObject({ input: 'text' });
        expect(readVoiceJourney()?.durationMs).toBeUndefined();
        expect(h.parseTextLog).toHaveBeenCalledTimes(1);
    });

    it('offline (kept for later as a job): this path says nothing', async () => {
        online.mockReturnValue(false);
        vi.spyOn(proto, 'enqueueOfflineVoiceJob').mockResolvedValue(undefined);
        await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, SCOPE, [] as CropProfile[], PROFILE);
        await new BackendAiClient().parseInput({ type: 'audio', data: 'AQID', mimeType: 'audio/webm' }, SCOPE, [] as CropProfile[], PROFILE);
        expect(readVoiceJourney()).toBeNull();
    });

    it('a recording whose clip write fails says nothing (the parse reports its error as before)', async () => {
        vi.spyOn(proto, 'resolveVoiceUploadMaterial').mockResolvedValue(MATERIAL);
        vi.spyOn(proto, 'persistProcessingVoiceClip').mockRejectedValue(new Error('disk full'));
        const result = await new BackendAiClient().parseInput({ type: 'audio', data: 'AQID', mimeType: 'audio/webm' }, SCOPE, [] as CropProfile[], PROFILE);
        expect(result).toEqual({ success: false, error: 'disk full' });
        expect(readVoiceJourney()).toBeNull();
    });
});
