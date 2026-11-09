// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 1; D-83 = 1, P11) - the pull's `plotPlanningState`.
 *
 * Through the real `reconcileSyncPull` over a fake-indexeddb phone database:
 *   - the key is stored in `appMeta` (no Dexie version): one key, replaced WHOLE on every pull the key arrives in;
 *   - an ABSENT key (an older server) leaves what is there untouched, and never clears it;
 *   - a row that cannot be read is dropped and the rest are kept; the pull never throws over it (P11).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { reconcileSyncPull } from '../../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { PLOT_PLANNING_STATE_META_KEY, readPlanningStates } from '../../../../../infrastructure/storage/planningStateStore';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const PLOT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const PLOT_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const CYCLE_A = 'cccccccc-0000-4000-8000-000000000001';

const state = (plotId: string, over: Record<string, unknown> = {}) => ({
    plotId, cropCycleId: CYCLE_A, inTrial: false, followsAllowed: false, canFollowSomething: true,
    trialStage: null, needsSchedule: true, ...over,
});

const pull = (extra: Record<string, unknown> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-09T06:00:00.000Z', nextCursorUtc: '2026-11-09T06:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', ...extra,
} as unknown as SyncPullResponse);

const ids = async () => ((await readPlanningStates())?.states ?? []).map(s => (s as { plotId: string }).plotId).sort();

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().appMeta.clear();
});

describe('plotPlanningState is kept in appMeta (Task 1)', () => {
    it('Present_key_is_stored: one appMeta row, the rows as the server said them', async () => {
        await reconcileSyncPull(pull({ plotPlanningState: [state(PLOT_A), state(PLOT_B, { inTrial: true, needsSchedule: false, trialStage: { name: 'Pruning', startDay: 0, endDay: 14 } })] }));
        const row = await getDatabase().appMeta.get(PLOT_PLANNING_STATE_META_KEY);
        expect(row).toBeDefined();
        const kept = await readPlanningStates();
        expect(kept?.states).toHaveLength(2);
        const b = kept?.states.find(s => (s as { plotId: string }).plotId === PLOT_B) as Record<string, unknown>;
        expect(b).toMatchObject({ inTrial: true, needsSchedule: false, trialStage: { name: 'Pruning', startDay: 0, endDay: 14 } });
        const a = kept?.states.find(s => (s as { plotId: string }).plotId === PLOT_A) as Record<string, unknown>;
        expect(a).toMatchObject({ needsSchedule: true, canFollowSomething: true, followsAllowed: false, inTrial: false, trialStage: null, cropCycleId: CYCLE_A });
    });

    it('Absent_key_leaves_it_untouched: an older server sends no key, nothing is cleared', async () => {
        await reconcileSyncPull(pull({ plotPlanningState: [state(PLOT_A)] }));
        await reconcileSyncPull(pull()); // no plotPlanningState at all
        expect(await ids()).toEqual([PLOT_A]);
        const before = await getDatabase().appMeta.get(PLOT_PLANNING_STATE_META_KEY);
        await reconcileSyncPull(pull({ plotPlanningState: 'not a list' }));
        expect(await getDatabase().appMeta.get(PLOT_PLANNING_STATE_META_KEY)).toEqual(before);
    });

    it('Replaced_whole: the next pull that carries the key replaces it (a plot it no longer lists is gone; an empty list empties it)', async () => {
        await reconcileSyncPull(pull({ plotPlanningState: [state(PLOT_A), state(PLOT_B)] }));
        expect(await ids()).toEqual([PLOT_A, PLOT_B]);
        await reconcileSyncPull(pull({ plotPlanningState: [state(PLOT_B, { needsSchedule: false, followsAllowed: true })] }));
        expect(await ids()).toEqual([PLOT_B]);
        expect((await readPlanningStates())?.states[0]).toMatchObject({ needsSchedule: false, followsAllowed: true });
        await reconcileSyncPull(pull({ plotPlanningState: [] }));
        expect(await ids()).toEqual([]);
        expect(await readPlanningStates()).not.toBeNull(); // present, and empty = "ask nothing"
    });

    it('Bad_row_dropped: a row that cannot be read goes, the others stay, the pull does not throw', async () => {
        await expect(reconcileSyncPull(pull({
            plotPlanningState: [
                state(PLOT_A),
                { plotId: PLOT_B, inTrial: 'yes', followsAllowed: false, canFollowSomething: true, needsSchedule: true }, // not a boolean
                { inTrial: false, followsAllowed: false, canFollowSomething: true, needsSchedule: true }, // no plot
                null,
                'junk',
                state('', { needsSchedule: true }), // empty plot id
                state('aaaaaaaa-0000-4000-8000-000000000003', { trialStage: { name: '', startDay: 'x', endDay: 3 } }), // unreadable stage: the row is dropped, never half-read
            ],
        }))).resolves.toBeUndefined();
        expect(await ids()).toEqual([PLOT_A]);
    });
});
