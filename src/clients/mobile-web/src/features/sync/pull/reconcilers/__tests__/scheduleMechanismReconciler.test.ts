// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 - slice 1, "The switch" (P11).
 *
 * Through the real `reconcileSyncPull` over a fake-indexeddb phone database. The pull's `capabilities.scheduleMechanism.farmIds`
 * is FULL on every pull (the owner flips a switch and no row changes), so it is stored whole in `appMeta`, replacing the last
 * answer. Unlike the other pull keys, an ABSENT key is an answer: the server omits it when the switch is off for every farm of the
 * pull, and an older server never sends it - both are OFF and clear what was stored, so a switch turned off, or a server rolled
 * back, never leaves a phone showing screens the server would refuse. Nothing here ever throws into the pull, and no other part
 * of the pull is touched by it.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../infrastructure/reference/TemplateCatalog', async importOriginal => ({
    ...(await importOriginal<object>()),
    setScheduleTemplatesFromReferenceData: vi.fn(),
}));

import { reconcileSyncPull } from '../../SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SCHEDULE_MECHANISM_META_ROW, readScheduleMechanismFarmIds } from '../../../../../core/session/scheduleMechanism';
import { PLOT_PLANNING_STATE_META_KEY, readPlanningStates } from '../../../../../infrastructure/storage/planningStateStore';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const PLOT_A = 'aaaaaaaa-0000-4000-8000-000000000001';

const pull = (extra: Record<string, unknown> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-23T06:00:00.000Z', nextCursorUtc: '2026-11-23T06:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h', ...extra,
} as unknown as SyncPullResponse);

const on = (...farmIds: string[]) => ({ capabilities: { scheduleMechanism: { farmIds } } });

beforeEach(async () => {
    await resetDatabase();
    await getDatabase().appMeta.clear();
});

describe('capabilities.scheduleMechanism is kept in appMeta (slice 1)', () => {
    it('Present_list_is_stored_whole', async () => {
        await reconcileSyncPull(pull(on(FARM_A)));
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_A]);
        expect(await getDatabase().appMeta.get(SCHEDULE_MECHANISM_META_ROW)).toBeDefined();
    });

    it('Replaced_whole_by_the_next_pull_(a_farm_it_no_longer_lists_is_off)', async () => {
        await reconcileSyncPull(pull(on(FARM_A, FARM_B)));
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_A, FARM_B]);
        await reconcileSyncPull(pull(on(FARM_B)));
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_B]);
    });

    it('Absent_key_is_OFF_and_clears_the_last_answer_(the_server_omits_it_when_off,_an_older_server_never_sends_it)', async () => {
        await reconcileSyncPull(pull(on(FARM_A)));
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_A]);
        await reconcileSyncPull(pull()); // no capabilities at all
        expect(await readScheduleMechanismFarmIds()).toEqual([]);
    });

    it('Off_on_a_phone_that_holds_no_answer_writes_nothing_(a_pull_from_a_server_where_it_was_never_on_leaves_appMeta_as_it_was)', async () => {
        await reconcileSyncPull(pull());
        await reconcileSyncPull(pull({ capabilities: { scheduleMechanism: { farmIds: [] } } }));
        expect(await getDatabase().appMeta.get(SCHEDULE_MECHANISM_META_ROW)).toBeUndefined();
        expect(await readScheduleMechanismFarmIds()).toEqual([]);
    });

    it('Unreadable_values_are_OFF_and_the_pull_never_throws_over_them', async () => {
        await reconcileSyncPull(pull(on(FARM_A)));
        for (const capabilities of ['on', 7, null, [], {}, { scheduleMechanism: 'yes' }, { scheduleMechanism: { farmIds: 'all' } },
            { scheduleMechanism: { farmIds: [{ id: FARM_A }, 3] } }, { somethingNew: { x: 1 } }]) {
            await reconcileSyncPull(pull(on(FARM_A)));
            await expect(reconcileSyncPull(pull({ capabilities }))).resolves.toBeUndefined();
            expect(await readScheduleMechanismFarmIds()).toEqual([]);
        }
    });

    it('Unknown_siblings_under_capabilities_are_ignored_(a_later_slice_adds_keys_beside_it)', async () => {
        await reconcileSyncPull(pull({ capabilities: { scheduleMechanism: { farmIds: [FARM_A], future: 1 }, somethingElse: { on: true } } }));
        expect(await readScheduleMechanismFarmIds()).toEqual([FARM_A]);
    });

    it('Touches_nothing_else_of_the_pull_(the_planning_gate_is_stored_exactly_as_before)', async () => {
        const state = [{ plotId: PLOT_A, cropCycleId: null, inTrial: false, followsAllowed: false, canFollowSomething: true, trialStage: null, needsSchedule: true }];
        await reconcileSyncPull(pull({ plotPlanningState: state }));
        const without = await getDatabase().appMeta.get(PLOT_PLANNING_STATE_META_KEY);

        await resetDatabase();
        await getDatabase().appMeta.clear();
        await reconcileSyncPull(pull({ plotPlanningState: state, ...on(FARM_A) }));
        const withIt = await getDatabase().appMeta.get(PLOT_PLANNING_STATE_META_KEY);

        expect((await readPlanningStates())?.states).toHaveLength(1);
        expect(withIt?.value && (withIt.value as { states: unknown }).states).toEqual(without?.value && (without.value as { states: unknown }).states);
    });
});
