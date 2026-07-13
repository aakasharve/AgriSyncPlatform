/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * findConfirmableTaskCloses — TDD plan (Task 5, "राहिलं → झालं", spec:
 * dfes-companion-2026-07-11). The no-false-close cases are the point: this
 * matcher must NEVER surface a candidate across plots, on a future/absent/
 * stale dueDate, without a real title-containment match, or via positional
 * pairing.
 */
import { describe, it, expect } from 'vitest';
import type { CropActivityEvent, DailyLog, PlannedTask } from '../../../../types';
import { findConfirmableTaskCloses, TASK_CLOSE_STALE_DAYS } from '../taskAutoClose';

const TODAY = '2026-07-14';

function makeTask(overrides: Partial<PlannedTask> = {}): PlannedTask {
    return {
        id: 'task-1',
        title: 'Pruning',
        plotId: 'plot-a',
        cropId: 'crop-1',
        priority: 'normal',
        status: 'pending',
        sourceType: 'manual',
        createdAt: '2026-07-01T06:00:00.000Z',
        dueDate: TODAY,
        ...overrides,
    };
}

function makeActivity(title: string, overrides: Partial<CropActivityEvent> = {}): CropActivityEvent {
    return { id: `act-${title}`, title, ...overrides };
}

function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1',
        date: TODAY,
        context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-a'], selectedPlotNames: ['Plot A'] }] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [makeActivity('Pruning done today')],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

describe('findConfirmableTaskCloses', () => {
    it('same-plot + due + title-substring match → candidate', () => {
        const task = makeTask();
        const log = makeLog();

        const result = findConfirmableTaskCloses([task], log, TODAY);

        expect(result).toHaveLength(1);
        expect(result[0].task.id).toBe('task-1');
        expect(result[0].matchedActivityTitle).toBe('Pruning done today');
    });

    it('different plot → excluded (never cross-plot)', () => {
        const task = makeTask({ plotId: 'plot-b' });
        const log = makeLog(); // logged plot is 'plot-a'

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('task already done → excluded', () => {
        const task = makeTask({ status: 'done' });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('task cancelled → excluded', () => {
        const task = makeTask({ status: 'cancelled' });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('dueDate in the future → excluded', () => {
        const task = makeTask({ dueDate: '2026-07-15' });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('dueDate absent → excluded (no date is too ambiguous)', () => {
        const task = makeTask({ dueDate: undefined });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it(`dueDate staler than the ${TASK_CLOSE_STALE_DAYS}-day window → excluded`, () => {
        const staleDate = '2026-06-01'; // more than 21 days before 2026-07-14
        const task = makeTask({ dueDate: staleDate });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it(`dueDate exactly at the ${TASK_CLOSE_STALE_DAYS}-day boundary → included`, () => {
        // 2026-06-23 is exactly 21 days before 2026-07-14.
        const task = makeTask({ dueDate: '2026-06-23' });
        const log = makeLog();

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(1);
    });

    it('title with NO containment → excluded', () => {
        const task = makeTask({ title: 'Fertilizer application' });
        const log = makeLog({ cropActivities: [makeActivity('Weeding')] });

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('confirms NO positional pairing: two unrelated same-plot/same-day tasks/activities with non-matching titles → no candidate', () => {
        const tasks = [
            makeTask({ id: 'task-a', title: 'Fertilizer application' }),
            makeTask({ id: 'task-b', title: 'Machinery servicing' }),
        ];
        const log = makeLog({
            cropActivities: [
                makeActivity('Weeding'),
                makeActivity('Irrigation check'),
            ],
        });

        // Neither task title has any containment relationship with either
        // activity title — a positional/index fallback would wrongly pair
        // task-a<->Weeding and task-b<->Irrigation check. There must be none.
        expect(findConfirmableTaskCloses(tasks, log, TODAY)).toHaveLength(0);
    });

    it('no savedLog → excluded', () => {
        const task = makeTask();

        expect(findConfirmableTaskCloses([task], undefined, TODAY)).toHaveLength(0);
    });

    it('no cropActivities on the saved log → excluded', () => {
        const task = makeTask();
        const log = makeLog({ cropActivities: [] });

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(0);
    });

    it('case/whitespace-insensitive containment match', () => {
        const task = makeTask({ title: '  PRUNING  ' });
        const log = makeLog({ cropActivities: [makeActivity('pruning')] });

        expect(findConfirmableTaskCloses([task], log, TODAY)).toHaveLength(1);
    });

    it('multiple valid candidates are ordered deterministically by dueDate then title', () => {
        const tasks = [
            makeTask({ id: 'task-late', title: 'Weeding', dueDate: '2026-07-10' }),
            makeTask({ id: 'task-early', title: 'Fertilizer', dueDate: '2026-07-05' }),
        ];
        const log = makeLog({
            cropActivities: [makeActivity('Weeding done'), makeActivity('Fertilizer done')],
        });

        const result = findConfirmableTaskCloses(tasks, log, TODAY);

        expect(result.map(c => c.task.id)).toEqual(['task-early', 'task-late']);
    });

    it('dedups by task.id (never double-counts the same task)', () => {
        const task = makeTask();
        const log = makeLog();

        const result = findConfirmableTaskCloses([task, task], log, TODAY);

        expect(result).toHaveLength(1);
    });
});
