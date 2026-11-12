// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 5; founder D-132 Q6 = 1, Q8 = 1; 3 + 1) - the per-plot "हे पाळा" of a person's own
 * schedule goes through the EXISTING adopt (`saveScheduleChoice`), this plot only, no new write kind:
 *   - a plot with no schedule of his own yet takes it as an ADDITION in his own place (never a switch of the main outside schedule);
 *   - taking a NEWER version, or another own schedule, is a migrate FROM the plot's own subscription (not from the main one);
 *   - the unanswered row the phone keeps says it is his own (origin Own, place 0), so the page never draws a "not checked" badge on it.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { ScheduleSubscriptionRow } from '../../../../infrastructure/storage/scheduleSubscriptionRow';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { saveScheduleChoice } from '../saveScheduleChoice';

const FARM = '11111111-1111-4111-8111-111111111111';
const PLOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const CYCLE = 'cccccccc-0000-4000-8000-000000000001';
const OUTSIDE = '10000000-0000-4000-8000-0000000000b1';
const OWN_V1 = '10000000-0000-4000-8000-0000000000a1';
const OWN_V2 = '10000000-0000-4000-8000-0000000000a2';
const OTHER_OWN = '10000000-0000-4000-8000-0000000000a9';
const SUB_OUT = 'dddddddd-0000-4000-8000-0000000000b1';
const SUB_OWN = 'dddddddd-0000-4000-8000-0000000000a1';

const sub = (id: string, templateId: string, over: Partial<ScheduleSubscriptionRow>): ScheduleSubscriptionRow => ({
    id, farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId, referenceDate: null, state: 'Active', adoptedAtUtc: '2026-10-05T00:00:00Z', ...over,
});
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.scheduleSubscriptions.clear(), db.plots.clear(), db.cropCycles.clear(), db.appMeta.clear()]);
    await db.plots.put({ id: PLOT, farmId: FARM, payload: { id: PLOT, farmId: FARM, name: 'A' }, updatedAt: '2026-10-01T00:00:00Z' });
    await db.cropCycles.put({ id: CYCLE, farmId: FARM, plotId: PLOT, updatedAt: '2026-10-01T00:00:00Z', payload: { id: CYCLE, farmId: FARM, plotId: PLOT, cropName: 'Grapes', stage: 'x', startDate: '2026-10-17' } });
});
afterEach(() => vi.restoreAllMocks());

describe('his own schedule on a plot', () => {
    it('First_take_is_an_ADOPT_for_this_plot_in_his_own_place_even_while_an_outside_schedule_is_the_main_one', async () => {
        await getDatabase().scheduleSubscriptions.put(sub(SUB_OUT, OUTSIDE, { origin: 'Outside', slot: 1, isMain: true }));
        const result = await saveScheduleChoice([{ plotId: PLOT, templateId: OWN_V1, add: true, own: true }]);
        const q = await queue();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.AdoptSchedule]); // never a migrate of the outside one
        expect(q[0].payload).toMatchObject({ plotId: PLOT, scheduleTemplateId: OWN_V1 });
        const kept = await getDatabase().scheduleSubscriptions.get(result.subscriptionIds[PLOT]);
        expect(kept).toMatchObject({ pending: true, origin: 'Own', slot: 0, templateId: OWN_V1 });
        expect(kept?.isMain).not.toBe(true);
        // the outside schedule is untouched
        const outside = await getDatabase().scheduleSubscriptions.get(SUB_OUT);
        expect(outside?.templateId).toBe(OUTSIDE);
        expect(outside?.ending).toBeUndefined();
    });

    it('Taking_a_newer_version_is_a_MIGRATE_from_the_own_row_not_from_the_main_outside_row', async () => {
        const db = getDatabase();
        await db.scheduleSubscriptions.bulkPut([
            sub(SUB_OUT, OUTSIDE, { origin: 'Outside', slot: 1, isMain: true }),
            sub(SUB_OWN, OWN_V1, { origin: 'Own', slot: 0 }),
        ]);
        const result = await saveScheduleChoice([{ plotId: PLOT, templateId: OWN_V2, replaces: SUB_OWN, own: true }]);
        const q = await queue();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.MigrateSchedule]);
        expect(q[0].payload).toMatchObject({ plotId: PLOT, newScheduleTemplateId: OWN_V2, fromSubscriptionId: SUB_OWN });
        const kept = await db.scheduleSubscriptions.get(result.subscriptionIds[PLOT]);
        expect(kept).toMatchObject({ pending: true, origin: 'Own', slot: 0, replacesId: SUB_OWN, templateId: OWN_V2 });
        // the row it replaces is not touched (the pending row stands in for it)
        expect(await db.scheduleSubscriptions.get(SUB_OWN)).toMatchObject({ templateId: OWN_V1, state: 'Active' });
    });

    it('A_tap_that_names_a_row_the_plot_does_not_hold_sends_NOTHING_and_never_falls_back_to_the_main_row (P005)', async () => {
        const db = getDatabase();
        await db.scheduleSubscriptions.put(sub(SUB_OUT, OUTSIDE, { origin: 'Outside', slot: 1, isMain: true }));
        const result = await saveScheduleChoice([{ plotId: PLOT, templateId: OWN_V2, replaces: 'dddddddd-0000-4000-8000-0000000000ff', own: true }]);
        expect(await queue()).toEqual([]);
        expect(result.missing).toEqual([PLOT]);
        expect(result.queued).toEqual([]);
        expect(result.notSent).toEqual([]);
        // the plot's rows are exactly as they were: the main outside schedule is neither replaced nor marked
        const rows = await db.scheduleSubscriptions.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: SUB_OUT, templateId: OUTSIDE });
    });

    it('Taking_another_own_schedule_is_the_same_migrate_from_the_own_row', async () => {
        await getDatabase().scheduleSubscriptions.put(sub(SUB_OWN, OWN_V1, { origin: 'Own', slot: 0, isMain: true }));
        await saveScheduleChoice([{ plotId: PLOT, templateId: OTHER_OWN, replaces: SUB_OWN, own: true }]);
        const q = await queue();
        expect(q.map(r => r.mutationType)).toEqual([SyncMutationName.MigrateSchedule]);
        expect(q[0].payload).toMatchObject({ newScheduleTemplateId: OTHER_OWN, fromSubscriptionId: SUB_OWN });
    });

    it('Taking_the_version_the_plot_already_follows_says_nothing_to_the_server', async () => {
        await getDatabase().scheduleSubscriptions.put(sub(SUB_OWN, OWN_V2, { origin: 'Own', slot: 0 }));
        const result = await saveScheduleChoice([{ plotId: PLOT, templateId: OWN_V2, replaces: SUB_OWN, own: true }]);
        expect(result.unchanged).toEqual([PLOT]);
        expect(await queue()).toEqual([]);
    });

    it('The_old_calls_are_unchanged: a plain switch still migrates the main row and an addition still adds', async () => {
        await getDatabase().scheduleSubscriptions.put(sub(SUB_OUT, OUTSIDE, { origin: 'Outside', slot: 1, isMain: true }));
        await saveScheduleChoice([{ plotId: PLOT, templateId: '10000000-0000-4000-8000-0000000000c1' }]);
        expect((await queue()).map(r => r.mutationType)).toEqual([SyncMutationName.MigrateSchedule]);
        expect((await queue())[0].payload).toMatchObject({ fromSubscriptionId: SUB_OUT });
    });
});
