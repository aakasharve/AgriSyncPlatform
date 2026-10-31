// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 / D-60) — words kept OFFLINE remember where
 * and when he meant them: every crop and plot he picked (not only the first plot), and the past day he chose before
 * speaking; the gear's number is told at once. Real Dexie (fake-indexeddb).
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../BackendAiClient.helpers', async importOriginal => ({
    ...(await importOriginal<typeof import('../BackendAiClient.helpers')>()),
    resolveFarmIdFromCache: async () => 'farm-1',
    resolveUserIdFromSession: () => 'user-1',
}));

import { BackendAiClient } from '../BackendAiClient';
import { OFFLINE_DAY_REFUSED_MESSAGE, OFFLINE_SAVED_MESSAGE, setOfflineVoiceDayProvider } from '../offlineVoiceQueue';
import { readableError } from '../../../features/voice/components/recorder/recorderWords';
import { getDatabase, resetDatabase } from '../../storage/DexieDatabase';
import { VOICE_NOTES_CHANGED } from '../../sync/waitingVoiceNotes';
import type { CropProfile, FarmerProfile, LogScope } from '../../../types';

const TWO_PLOTS: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['g1', 'g2'], mode: 'multi', applyPolicy: 'broadcast' };
const PROFILE = { activeOperatorId: 'user-1', operators: [] } as unknown as FarmerProfile;

describe('offline: the place and the day travel with the words', () => {
    let online: ReturnType<typeof vi.spyOn>;
    let context: ReturnType<typeof vi.spyOn>;
    beforeEach(async () => {
        try { await getDatabase().delete(); } catch { /* first run */ }
        await resetDatabase();
        context = vi.spyOn(BackendAiClient.prototype as unknown as { buildContext: () => unknown }, 'buildContext').mockReturnValue({});
        online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    });
    afterEach(() => { online.mockRestore(); context.mockRestore(); setOfflineVoiceDayProvider(() => undefined); });

    it('every plot he picked and the past day he chose are kept on the job; the number is told', async () => {
        setOfflineVoiceDayProvider(() => '2026-10-28');
        const heard = vi.fn();
        window.addEventListener(VOICE_NOTES_CHANGED, heard);
        const r = await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, TWO_PLOTS, [] as CropProfile[], PROFILE);
        window.removeEventListener(VOICE_NOTES_CHANGED, heard);
        expect(r).toEqual({ success: false, error: OFFLINE_SAVED_MESSAGE });
        const [job] = await getDatabase().pendingAiJobs.toArray();
        expect(job.context).toMatchObject({ plotId: 'g1', scopeCropIds: ['grape'], scopePlotIds: ['g1', 'g2'], dateKey: '2026-10-28' });
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('no day chosen: none kept on the job (it is the day he spoke)', async () => {
        setOfflineVoiceDayProvider(() => undefined);
        await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, TWO_PLOTS, [] as CropProfile[], PROFILE);
        const [job] = await getDatabase().pendingAiJobs.toArray();
        expect(job.context.dateKey).toBeUndefined();
    });

    it('fix 1 (L4): a day lookup that FAILS is refused plainly — never quietly kept on the day he spoke', async () => {
        setOfflineVoiceDayProvider(() => { throw new Error('no store'); });
        const r = await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, TWO_PLOTS, [] as CropProfile[], PROFILE);
        expect(r).toEqual({ success: false, error: OFFLINE_DAY_REFUSED_MESSAGE });
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
    });

    it('fix 1 (H1): a day AFTER today is refused — nothing kept for a future day', async () => {
        setOfflineVoiceDayProvider(() => '2099-01-01');
        const r = await new BackendAiClient().parseInput({ type: 'text', content: 'पाणी दिलं' }, TWO_PLOTS, [] as CropProfile[], PROFILE);
        expect(r).toEqual({ success: false, error: OFFLINE_DAY_REFUSED_MESSAGE });
        expect(await getDatabase().pendingAiJobs.count()).toBe(0);
    });

    it.each(['mr', 'en'] as const)('fix 1: the refusal is said in his language (%s)', language => {
        const shown = readableError(OFFLINE_DAY_REFUSED_MESSAGE, language);
        expect(shown).not.toBe(OFFLINE_DAY_REFUSED_MESSAGE);
        expect(/[ऀ-ॿ]/.test(shown)).toBe(language === 'mr');
        expect(shown).toContain(language === 'mr' ? 'दिवस' : 'day');
    });
});
