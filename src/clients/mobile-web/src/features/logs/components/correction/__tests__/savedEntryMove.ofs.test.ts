// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1, D-61 = 5A) — "प्लॉट बदला" / "दिवस बदला"
 * on a SAVED entry, with no internet: the move is QUEUED (the real queue over fake-indexeddb, the real contract check
 * at enqueue) and written on this phone through the one edit path; it shows on the entry at once and reaches the
 * server on the next sync. A day that has not come yet is refused before anything is written; pressing again after a
 * failed step queues the SAME move, never a second one.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readPendingLogIds } from '../../../../sync/pull/internal/pendingMutations';
import { FutureDayRefused } from '../../../../../core/domain/services/farmDay';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../../types';
import { canMoveSavedEntry, canQueueLabourCountOffline, contextForPlace, queueSavedEntryMove, type SavedEntryMoveDeps } from '../correctionCapabilities';

vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => ({
    ...(await orig<typeof import('../../../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => '2026-10-31',
}));

const LOG = '0f5e2000-0000-4000-8000-0000000000a1';
const G1 = '0f5e2000-0000-4000-8000-0000000000b1';
const S1 = '0f5e2000-0000-4000-8000-0000000000b2';
const CROPS = [
    { id: 'grape', name: 'Grapes', plots: [{ id: G1, name: 'सोनाका' }] },
    { id: 'cane', name: 'Sugarcane', plots: [{ id: S1, name: 'खालचा' }] },
] as unknown as CropProfile[];
const PROFILE = { activeOperatorId: 'me' } as unknown as FarmerProfile;
const ENTRY = {
    id: LOG, date: '2026-10-25', contentVersion: 3,
    context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: [G1], selectedPlotNames: ['सोनाका'] }] },
} as unknown as DailyLog;
const scope = (plots: string[], crops: string[] = []): LogScope => ({ selectedPlotIds: plots, selectedCropIds: crops, mode: plots.length > 1 ? 'multi' : 'single', applyPolicy: 'broadcast' });

/** The edit path as a stand-in that keeps what it was asked to write (the real one is `UpdateLog`). */
const deps = (failOnce = false) => {
    const written: Partial<DailyLog>[] = [];
    let history: DailyLog[] = [ENTRY];
    let fail = failOnce;
    const d: SavedEntryMoveDeps = {
        crops: CROPS,
        profile: PROFILE,
        updateLog: async (_id, updates) => {
            if (fail) { fail = false; return { success: false, error: 'disk full' }; }
            written.push(updates);
            return { success: true, log: { ...ENTRY, ...updates } as DailyLog };
        },
        setHistory: update => { history = update(history); },
    };
    return { d, written, history: () => history };
};

const moves = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.MoveDailyLog);

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('lane OF-S — moving a saved entry, offline', () => {
    it('both switches are on', () => {
        expect(canMoveSavedEntry()).toBe(true);
        expect(canQueueLabourCountOffline()).toBe(true);
    });

    it('another plot: queued with the version he saw, written on this phone one version on, held from the pull', async () => {
        const { d, written, history } = deps();
        const moved = await queueSavedEntryMove(ENTRY, { scope: scope([S1], ['cane']) }, d);

        const [row] = await moves();
        expect(row.status).toBe('PENDING');
        expect(row.payload).toMatchObject({ dailyLogId: LOG, baseVersion: 3, newPlotIds: [S1] });
        expect(row.payload).not.toHaveProperty('newLogDate');
        expect(written[0]).toEqual({
            context: { selection: [{ cropId: 'cane', cropName: 'Sugarcane', selectedPlotIds: [S1], selectedPlotNames: ['खालचा'] }] },
            contentVersion: 4,
        });
        expect(moved.context.selection[0].selectedPlotIds).toEqual([S1]);
        expect(history()[0].context.selection[0].selectedPlotNames).toEqual(['खालचा']); // shows on the entry at once
        expect(await readPendingLogIds(getDatabase())).toContain(LOG);
    });

    it('another day, and the whole farm: what the server is told, and what this phone shows', async () => {
        const { d, written } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24', scope: scope([], ['FARM_GLOBAL']) }, d);
        const [row] = await moves();
        expect(row.payload).toMatchObject({ dailyLogId: LOG, baseVersion: 3, wholeFarm: true, newLogDate: '2026-10-24' });
        expect(row.payload).not.toHaveProperty('newPlotIds');
        expect(written[0]).toMatchObject({ date: '2026-10-24', contentVersion: 4 });
        expect(written[0].context?.selection[0]).toMatchObject({ cropId: 'FARM_GLOBAL', selectedPlotIds: [] });
    });

    it('several plots go as several plots', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { scope: scope([G1, S1], ['grape', 'cane']) }, d);
        expect((await moves())[0].payload).toMatchObject({ newPlotIds: [G1, S1] });
        expect(contextForPlace(scope([G1, S1]), CROPS)?.selection.map(s => s.cropId)).toEqual(['grape', 'cane']);
    });

    it('a day that has not come yet is refused before anything is queued or written', async () => {
        const { d, written } = deps();
        await expect(queueSavedEntryMove(ENTRY, { dateKey: '2026-11-01' }, d)).rejects.toBeInstanceOf(FutureDayRefused);
        expect(await moves()).toHaveLength(0);
        expect(written).toHaveLength(0);
    });

    it('a plot this phone does not know is refused (never written with a place it cannot name)', async () => {
        const { d } = deps();
        await expect(queueSavedEntryMove(ENTRY, { scope: scope(['not-here']) }, d)).rejects.toThrow(/not on this phone/);
        expect(await moves()).toHaveLength(0);
    });

    it('pressing again after the phone write failed queues the SAME move once, then writes it', async () => {
        const { d, written } = deps(true);
        await expect(queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d)).rejects.toThrow(/not written on this phone/);
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);
        expect(await moves()).toHaveLength(1);
        expect(written).toHaveLength(1);
    });

    it('the place and day it already has: nothing is queued', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-25' }, d);
        expect(await moves()).toHaveLength(0);
    });
});
