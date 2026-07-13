/**
 * getCarriedTasks — Daily Clarity Loop v1, Fix 1 (carry-forward COHERENCE).
 *
 * spec: dfes-companion-2026-07-11
 *
 * The hero's "आज {N} कामं बाकी" number is todayDayState.pendingCount. The carried
 * qualifier BENEATH it must be a strict subset of that same pending set — so it
 * can only ever QUALIFY N, never contradict it. This proves:
 *   • carried = open tasks whose dueDate is STRICTLY before the day (overdue);
 *   • done / cancelled / due-today / no-date tasks are excluded;
 *   • getCarriedTasks(...).length <= computeDayState(...).pendingCount ALWAYS —
 *     even in the classic incoherence scenario (yesterday 5 pending, 3 remain).
 */

import { describe, it, expect } from 'vitest';
import { getCarriedTasks, computeDayState } from '../dayState';
import type { PlannedTask, CropProfile } from '../../../types';

const TODAY = '2026-07-13';
const YESTERDAY = '2026-07-12';
const TWO_DAYS_AGO = '2026-07-11';

// A single plot with NO schedule → computeDayState's plannedFromSchedule is 0,
// so pendingCount is purely the task contribution (isolates the coherence math).
function makeCrops(): CropProfile[] {
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [{ id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } }] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeTask(id: string, dueDate: string | undefined, status: PlannedTask['status']): PlannedTask {
    return {
        id,
        title: `task-${id}`,
        plotId: 'plot-a',
        cropId: 'crop-grapes',
        priority: 'normal',
        status,
        sourceType: 'ai_extracted',
        createdAt: `${TWO_DAYS_AGO}T06:00:00.000Z`,
        ...(dueDate ? { dueDate } : {}),
    };
}

describe('getCarriedTasks — the carried subset (overdue + open)', () => {
    it('returns only open tasks whose dueDate is strictly before the day', () => {
        const tasks = [
            makeTask('a', TWO_DAYS_AGO, 'pending'),      // carried, open  ✓
            makeTask('b', YESTERDAY, 'in_progress'),     // carried, open  ✓
            makeTask('c', YESTERDAY, 'done'),            // carried but DONE   ✗
            makeTask('d', YESTERDAY, 'cancelled'),       // carried but CANCELLED ✗
            makeTask('e', TODAY, 'pending'),             // due TODAY, not carried ✗
            makeTask('f', undefined, 'pending'),         // no date, not carried   ✗
        ];
        const carried = getCarriedTasks({ tasks, date: TODAY });
        expect(carried.map(t => t.id).sort()).toEqual(['a', 'b']);
    });

    it('COHERENCE: yesterday had 5 pending, 3 remain → carried k = 3, and k <= todays N (never 5)', () => {
        // 5 tasks all dated in the past (carried); 2 have since been completed,
        // leaving 3 still open. The old code showed a standalone "5"; the new
        // carried subset can only surface the 3 that are actually still pending.
        const tasks = [
            makeTask('t1', TWO_DAYS_AGO, 'pending'),     // open  ✓
            makeTask('t2', YESTERDAY, 'pending'),        // open  ✓
            makeTask('t3', YESTERDAY, 'in_progress'),    // open  ✓
            makeTask('t4', TWO_DAYS_AGO, 'done'),        // completed ✗
            makeTask('t5', YESTERDAY, 'done'),           // completed ✗
        ];

        const carried = getCarriedTasks({ tasks, date: TODAY });
        const today = computeDayState({ logs: [], crops: makeCrops(), tasks, date: TODAY });

        // N = today's pending (3 open carried tasks; the 2 done are excluded).
        expect(today.pendingCount).toBe(3);
        // The carried qualifier is exactly those 3 — never a divergent "5".
        expect(carried.length).toBe(3);
        // The load-bearing invariant: carried can never exceed N.
        expect(carried.length).toBeLessThanOrEqual(today.pendingCount);
    });

    it('respects crop/plot scope identically to pendingCount (stays a subset under scope)', () => {
        const other = { ...makeTask('z', YESTERDAY, 'pending'), plotId: 'plot-b', cropId: 'crop-other' };
        const tasks = [makeTask('a', YESTERDAY, 'pending'), other];

        const scope = { selectedCropIds: ['crop-grapes'], selectedPlotIds: ['plot-a'] };
        const carried = getCarriedTasks({ tasks, date: TODAY, ...scope });
        const today = computeDayState({ logs: [], crops: makeCrops(), tasks, date: TODAY, ...scope });

        // Only the in-scope carried task counts; the other plot's task is excluded.
        expect(carried.map(t => t.id)).toEqual(['a']);
        expect(carried.length).toBeLessThanOrEqual(today.pendingCount);
    });

    it('empty when nothing is carried (all due today / no date)', () => {
        const tasks = [makeTask('a', TODAY, 'pending'), makeTask('b', undefined, 'pending')];
        expect(getCarriedTasks({ tasks, date: TODAY })).toEqual([]);
    });
});
