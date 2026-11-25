// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12) - what the phone gathers for the stage question, from its own stores: the followed main schedule's day
 * cards (the phone's copy, or "none" with no signal), the own works (the server's rows AND the ones still waiting to be sent: it works offline, P10), and the plot's day
 * through the one helper.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import type { DayCardsDetail } from '../../../scheduler/dayCards/dayCardsTypes';
import type { DayCardsLoad } from '../../../scheduler/dayCards/dayCardsStore';
import { loadTaskStageState } from '../taskStageSource';

const PLOT = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const CYCLE = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const TEMPLATE = '11111111-1111-4111-8111-111111111111';

const task = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({
        taskKey: 't-look', name: 'कळी तपासणी', kind: 'observe', basis: 'stated', stageIndex: 0, order: 0,
        timing: { timer: 'day', fromDay: 40, toDay: 40, repeat: 'once' }, look: { sign: 'कळ्या फुटलेल्या दिसतात' },
        sources: [{ document: 'gap-table-grapes-2013', page: '19' }], ...over,
    });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

const detail = (tasks: ScheduleTaskContent[]): DayCardsDetail => ({
    templateId: TEMPLATE, chainId: null, version: 1, contentHash: 'h', kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: null }, check: { state: 'Checked', isChecked: true, checkedBy: null, checkedAtUtc: null },
    stages: [], challenges: [], skipped: 0,
    tasks: tasks.map(t => ({ task: t, contentHash: 'x', shown: { from: null, to: null, expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: true })),
});

const ok = (tasks: ScheduleTaskContent[]) => async (): Promise<DayCardsLoad> => ({ ok: true, detail: detail(tasks), source: 'network', stale: false });
const offline = async (): Promise<DayCardsLoad> => ({ ok: false, reason: 'offline-no-copy' });
const legacy = async (): Promise<DayCardsLoad> => ({ ok: false, reason: 'not-found' });

async function seed(opts: { referenceDate?: string | null; follow?: boolean } = {}) {
    const db = getDatabase();
    await db.cropCycles.put({ id: CYCLE, farmId: FARM, plotId: PLOT, payload: { id: CYCLE, startDate: '2026-10-15' }, updatedAt: '2026-10-15T00:00:00Z' });
    if (opts.follow !== false) {
        await db.scheduleSubscriptions.put({
            id: 's1', farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, templateId: TEMPLATE, referenceDate: opts.referenceDate ?? '2026-10-15',
            state: 'Active', adoptedAtUtc: '2026-10-15T00:00:00Z', isMain: true,
        });
    }
}

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.cropCycles.clear(), db.scheduleSubscriptions.clear(), db.ownScheduleItems.clear(), db.mutationQueue.clear()]);
});

describe('loadTaskStageState', () => {
    it('reads the followed schedule: the plot\'s day is counted from its start day (day 1) and the stored day 40 is asked on shown day 41', async () => {
        await seed();

        const on41 = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24', load: ok([task({})]) }); // 40 days after 15 Oct = shown day 41
        const on40 = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-23', load: ok([task({})]) });
        const on42 = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-25', load: ok([task({})]) });

        expect(on41?.shownDay).toBe(41);
        expect(on41?.source.lines.map(l => l.lineId)).toEqual(['task:t-look:look']);
        expect(on41?.cropCycleId).toBe(CYCLE);
        expect(on40?.source.lines).toEqual([]);
        expect(on42?.source.lines).toEqual([]);
        expect(on40?.source.hasTaskFormat).toBe(true);
    });

    it('a plot with no followed schedule and no own work has no task format: the embedded json stays its fallback', async () => {
        await seed({ follow: false });

        expect(await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24' })).toBeNull();
    });

    it('a followed schedule that is not written in the task format (the server does not know it as one) leaves the json as the fallback', async () => {
        await seed();

        const state = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24', load: legacy });

        expect(state?.source.hasTaskFormat).toBe(false);
        expect(state?.source.lines).toEqual([]);
    });

    it('with no signal and no copy of the followed schedule nothing is known to ask, and the json is NOT used (the server would refuse it)', async () => {
        await seed();

        const state = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24', load: offline });

        expect(state?.source).toEqual({ hasTaskFormat: true, lines: [] });
    });

    it('an own work waiting to be sent (queued offline) is asked: it is read from the queue as well as from the server rows', async () => {
        await seed({ follow: false });
        const mine = task({ taskKey: 'mine', basis: 'experience', sources: [] });
        await getDatabase().mutationQueue.add({
            mutationType: SyncMutationName.OwnscheduleItemSave, payload: { farmId: FARM, plotId: PLOT, cropCycleId: CYCLE, task: mine },
            status: 'PENDING', createdAt: '2026-11-24T01:00:00Z', clientRequestId: 'save-1', clientCommandId: 'save-1',
        } as never);

        const state = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24', load: offline });

        expect(state?.source.lines.map(l => [l.lineId, l.sourceLabelMr])).toEqual([['task:mine:look', 'स्रोत: तुमचा अनुभव']]);
    });

    it('the plot\'s own reference date moves its day 1 (the schedule\'s day 0 chosen in the editor), never the crop season\'s start', async () => {
        await seed({ referenceDate: '2026-10-20' });

        const state = await loadTaskStageState({ plotId: PLOT, todayKey: '2026-11-24', load: ok([task({ timing: { timer: 'day', fromDay: 35, toDay: 35, repeat: 'once' } })]) });

        expect(state?.shownDay).toBe(36);
        expect(state?.source.lines.map(l => l.taskKey)).toEqual(['t-look']);
    });
});
