// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (Task 2) - a recording that arrives with its duration is NOT decoded a second
 * time; only a clip with no duration at all is measured.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ estimate: vi.fn(), parseVoiceLog: vi.fn() }));

vi.mock('../BackendAiClient.helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../BackendAiClient.helpers')>()),
    resolveFarmIdFromCache: async () => 'farm-1',
    resolveUserIdFromSession: () => 'user-1',
    estimateAudioDurationMs: h.estimate,
}));
vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: { parseTextLog: vi.fn(), parseVoiceLog: h.parseVoiceLog },
}));

import { BackendAiClient } from '../BackendAiClient';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const SCOPE: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [] } as unknown as FarmerProfile;
const ANSWER = { parsedLog: { summary: '', dayOutcome: 'WORK_RECORDED', inputs: [], cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [], missingSegments: [] }, confidence: 0.9 };

describe('Task 2 - no duplicate decode', () => {
    let online: ReturnType<typeof vi.spyOn>;
    let context: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        context = vi.spyOn(BackendAiClient.prototype as unknown as { buildContext: () => unknown }, 'buildContext').mockReturnValue({});
        h.estimate.mockReset().mockResolvedValue(9_000);
        h.parseVoiceLog.mockReset().mockResolvedValue(ANSWER);
    });
    afterEach(() => { online.mockRestore(); context.mockRestore(); });

    it('with a recorder duration: never decoded, the clip row keeps that duration', async () => {
        const r = await new BackendAiClient().parseInput(
            { type: 'audio', data: 'AQID', mimeType: 'audio/webm', inputRawDurationMs: 46_200, idempotencyKey: 'clip-1' },
            SCOPE, [] as CropProfile[], PROFILE);
        expect(r.success).toBe(true);
        expect(h.estimate).not.toHaveBeenCalled();
        expect((await getDatabase().voiceClips.get('clip-1'))?.durationMs).toBe(46_200);
        expect(h.parseVoiceLog.mock.calls[0][4]).toMatchObject({ inputRawDurationMs: 46_200, inputSpeechDurationMs: 46_200 });
    });

    it('with only a speech duration: never decoded either', async () => {
        await new BackendAiClient().parseInput(
            { type: 'audio', data: 'AQID', mimeType: 'audio/webm', inputSpeechDurationMs: 30_000, idempotencyKey: 'clip-2' },
            SCOPE, [] as CropProfile[], PROFILE);
        expect(h.estimate).not.toHaveBeenCalled();
    });

    it('with no duration at all: decoded exactly once', async () => {
        await new BackendAiClient().parseInput(
            { type: 'audio', data: 'AQID', mimeType: 'audio/webm', idempotencyKey: 'clip-3' },
            SCOPE, [] as CropProfile[], PROFILE);
        expect(h.estimate).toHaveBeenCalledTimes(1);
        expect((await getDatabase().voiceClips.get('clip-3'))?.durationMs).toBe(9_000);
    });
});
