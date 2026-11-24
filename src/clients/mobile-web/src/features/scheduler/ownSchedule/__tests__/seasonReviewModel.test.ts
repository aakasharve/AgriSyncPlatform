/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; SM-13; P4, P8) - the four list rules of the season-end review: done as written is
 * pre-selected, done differently is asked with nothing pre-selected, no record is asked with two options and is never "not done", and work only planned is listed apart.
 */
import { describe, expect, it } from 'vitest';
import type { ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { LocalPlannedWork } from '../../../plannedWork/data/plannedWorkStore';
import { ownItemIdFor } from '../ownWorkPlan';
import {
    answersOf, buildSeasonReview, choicesOf, originNameOf, previousSeasonWithWork, shownDayOf, storedDayOf, type CarryChoice,
} from '../seasonReviewModel';

const OLD = 'c1c1c1c1-0000-4000-8000-0000000000c1';
const timing = (from: number | null, to: number | null = null, repeat: 'once' | 'every_n_days' = 'once'): ScheduleTaskContent['timing'] => ({
    timer: from === null ? 'none' : 'day', fromDay: from, toDay: to, afterTaskKey: null, usualDays: null, earliestDays: null, latestDays: null, signWords: null,
    expectedFromDay: null, expectedToDay: null, whenWords: null, repeat, repeatInterval: repeat === 'once' ? null : 3, repeatEndDay: null, repeatEndSign: null,
});
const task = (key: string, name: string, t = timing(5)): ScheduleTaskContent => ({
    taskKey: key, name, kind: 'work', timing: t, basis: 'stated', stageIndex: 0, order: 0, why: null, dose: null, steps: [], products: [], reEntryHours: null,
    preHarvestDays: null, warnings: [], look: null, ask: null, sources: [], origin: null,
});
const plan = (key: string, patch: Partial<LocalPlannedWork> = {}): LocalPlannedWork => ({
    id: `p-${key}-${patch.occurrence ?? 1}`, farmId: 'f', title: key, scope: 'Plot', plotIds: ['plot'], plannedDate: null, looseWhen: null, plannedTime: null,
    assigneeUserId: null, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Done', sourceKind: null, recordedOn: '2026-01-01',
    createdByUserId: null, modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false, plots: [], confirmationState: null,
    linkedDailyLogIds: [`log-${key}`], ownItemId: ownItemIdFor(OLD, key), scheduleTaskKey: key, occurrence: 1, ...patch,
} as LocalPlannedWork);

// The pruning (day 0) was 2026-01-01; "shown day N" is stored N - 1.
const DAY_ZERO = '2026-01-01';
const input = (works: { key: string; t: ScheduleTaskContent; state?: 'active' | 'removed' }[], plans: LocalPlannedWork[], logs: Record<string, string>) => ({
    works: works.map(w => ({ taskKey: w.key, task: w.t, state: w.state ?? ('active' as const) })),
    plans, logDays: new Map(Object.entries(logs)), dayZero: DAY_ZERO, cropCycleId: OLD,
});

describe('the one day helper', () => {
    it('stored = shown - 1, and a date counts from the pruning', () => {
        expect(shownDayOf(0)).toBe(1);
        expect(storedDayOf('2026-01-01', '2026-01-14')).toBe(13);
        expect(shownDayOf(storedDayOf('2026-01-01', '2026-01-14'))).toBe(14);
    });
});

describe('the four list rules', () => {
    const model = buildSeasonReview(input(
        [
            { key: 'a-written', t: task('a-written', 'छाटणी', timing(5, 9)) },
            { key: 'b-differs', t: task('b-differs', 'फवारणी', timing(10, 12)) },
            { key: 'c-none', t: task('c-none', 'पाणी', timing(3)) },
            { key: 'd-part', t: task('d-part', 'आळवणी', timing(2, null, 'every_n_days')) },
            { key: 'e-gone', t: task('e-gone', 'खुरपणी'), state: 'removed' },
            { key: 'f-gone-noplan', t: task('f-gone-noplan', 'तण'), state: 'removed' },
        ],
        [
            plan('a-written', { linkedDailyLogIds: ['la'] }),
            plan('b-differs', { linkedDailyLogIds: ['lb'] }),
            plan('d-part', { occurrence: 1, linkedDailyLogIds: ['ld'] }),
            plan('d-part', { occurrence: 2, status: 'Open', linkedDailyLogIds: [] }),
            plan('e-gone', { status: 'Open', linkedDailyLogIds: [] }),
        ],
        { la: '2026-01-07', lb: '2026-01-14', ld: '2026-01-04' },
    ));
    const q = (key: string) => model.questions.find(x => x.taskKey === key)!;

    it('done as written (a record inside the days of the work) is pre-selected "schedule" and changeable', () => {
        expect(q('a-written').kind).toBe('written');
        expect(q('a-written').preselected).toBe('schedule');
        expect(choicesOf(q('a-written'))).toEqual(['schedule', 'mine', 'skip']);
    });

    it('done differently (a record outside its days) shows both values and pre-selects nothing', () => {
        const d = q('b-differs');
        expect(d.kind).toBe('differs');
        expect(d.preselected).toBeNull();
        expect([d.expectedFrom, d.expectedTo]).toEqual([11, 13]);
        expect(d.recordedDay).toBe(14);
        expect(d.recordedOn).toBe('2026-01-14');
        expect(choicesOf(d)).toEqual(['schedule', 'mine', 'skip']);
    });

    it('a repeating work done some times and left open is part-done, asked with nothing pre-selected', () => {
        expect(q('d-part').kind).toBe('differs');
        expect(q('d-part').part).toBe(true);
        expect(q('d-part').preselected).toBeNull();
    });

    it('no record: two options only, nothing to copy as practice, nothing pre-selected, never a "not done" state', () => {
        const n = q('c-none');
        expect(n.kind).toBe('none');
        expect(n.recordedDay).toBeNull();
        expect(n.preselected).toBeNull();
        expect(choicesOf(n)).toEqual(['schedule', 'skip']);
        expect(JSON.stringify(model)).not.toMatch(/not.?done|notDone/i);
    });

    it('a work only planned (taken out of the schedule, its plan kept) is listed apart, and a removed work with no plan is not listed', () => {
        expect(model.planOnly).toEqual([{ taskKey: 'e-gone', name: 'खुरपणी' }]);
        expect(model.questions.map(x => x.taskKey)).not.toContain('e-gone');
    });
});

describe('what is sent', () => {
    const qs = buildSeasonReview(input(
        [{ key: 'a', t: task('a', 'अ', timing(5, 9)) }, { key: 'b', t: task('b', 'ब', timing(10)) }], [plan('a', { linkedDailyLogIds: ['la'] })], { la: '2026-01-07' },
    )).questions;

    it('only the answered works are listed; an untouched one is left for the server to carry as written', () => {
        const chosen = new Map<string, CarryChoice>([['a', 'schedule']]);
        expect(answersOf(chosen, qs)).toEqual([{ taskKey: 'a', choice: 'schedule' }]);
        expect(answersOf(new Map(), qs)).toEqual([]);
    });
});

describe('the season that ended', () => {
    const cycles = [{ id: 'c-2025', start: '2025-01-01' }, { id: 'c-2026', start: '2026-01-01' }, { id: 'c-2027', start: '2027-01-01' }];
    it('is the newest OLDER season with an own work; none for the first season', () => {
        expect(previousSeasonWithWork(cycles, 'c-2027', id => id === 'c-2026' || id === 'c-2025')).toBe('c-2026');
        expect(previousSeasonWithWork(cycles, 'c-2027', id => id === 'c-2025')).toBe('c-2025');
        expect(previousSeasonWithWork(cycles, 'c-2025', () => true)).toBeNull();
        expect(previousSeasonWithWork(cycles, 'c-2027', () => false)).toBeNull();
        expect(previousSeasonWithWork(cycles, 'nope', () => true)).toBeNull();
    });
});

describe('the origin name', () => {
    const rows = [{ id: 'd0d0d0d0-0000-4000-8000-0000000000a1', name: 'द्राक्ष: चाचणी संदर्भ' }];
    it('is the name of the schedule; a work made by hand or a schedule not on the phone names nobody', () => {
        expect(originNameOf('take:d0d0d0d0000040008000' + '0000000000a1', rows)).toBe('द्राक्ष: चाचणी संदर्भ');
        expect(originNameOf('take:ffffffff000040008000000000000000', rows)).toBeNull();
        expect(originNameOf(null, rows)).toBeNull();
        expect(originNameOf('hand', rows)).toBeNull();
    });
});
