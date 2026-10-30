// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B004) — offline, a correction's words are
 * NEVER kept as a pending job (it would come back later as a NEW log); a day's work still is. Both outcomes come back as
 * stable codes, and the recorder shows them in the person's language (the old English toast reached a Marathi screen).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../BackendAiClient.helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../BackendAiClient.helpers')>()),
    resolveFarmIdFromCache: async () => 'farm-1',
    resolveUserIdFromSession: () => 'user-1',
}));

import { BackendAiClient } from '../BackendAiClient';
import { OFFLINE_NOT_KEPT_MESSAGE, OFFLINE_SAVED_MESSAGE, setOfflineVoiceQueueGate } from '../offlineVoiceQueue';
import { readableError } from '../../../features/voice/components/recorder/recorderWords';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const SCOPE: LogScope = { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [] } as unknown as FarmerProfile;

describe('review B004 — the offline queue', () => {
    let online: ReturnType<typeof vi.spyOn>;
    let enqueue: ReturnType<typeof vi.spyOn>;
    let context: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        // the parse context is not what this test is about
        context = vi.spyOn(BackendAiClient.prototype as unknown as { buildContext: () => unknown }, 'buildContext').mockReturnValue({});
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        enqueue = vi.spyOn(BackendAiClient.prototype as unknown as { enqueueOfflineVoiceJob: () => Promise<void> }, 'enqueueOfflineVoiceJob').mockResolvedValue(undefined);
    });
    afterEach(() => { online.mockRestore(); enqueue.mockRestore(); context.mockRestore(); setOfflineVoiceQueueGate(() => true); });

    it('a day\'s work is kept on the phone for later, as before', async () => {
        const r = await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, SCOPE, [] as CropProfile[], PROFILE);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(r).toEqual({ success: false, error: OFFLINE_SAVED_MESSAGE });
    });

    it('a correction (the gate closed) is NOT kept: nothing queued, and it says so', async () => {
        setOfflineVoiceQueueGate(() => false);
        const r = await new BackendAiClient().parseInput({ type: 'text', content: 'इथरेल 350' }, SCOPE, [] as CropProfile[], PROFILE);
        expect(enqueue).not.toHaveBeenCalled();
        expect(r).toEqual({ success: false, error: OFFLINE_NOT_KEPT_MESSAGE });
    });

    it.each(['mr', 'en'] as const)('the recorder shows both outcomes in the person\'s language (%s)', language => {
        const devanagari = /[ऀ-ॿ]/;
        for (const code of [OFFLINE_SAVED_MESSAGE, OFFLINE_NOT_KEPT_MESSAGE]) {
            const shown = readableError(code, language);
            expect(shown).not.toBe(code);
            expect(devanagari.test(shown)).toBe(language === 'mr');
        }
    });
});
