/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1)
 *
 * The तुलना card's numbers come from the real comparison and nothing else: what was due in the last 7 days,
 * what the work RECORDED in those 7 days met (the engine's own matcher), what is still open (grouped, at most
 * three rows, newest first), older open work only counted — and "—" (null), never an invented 100%, when
 * nothing was due. Labels are Marathi, never the engine's English operation names.
 *
 * I14 verifier BLOCKER (I14-V2-01): the stage-wide `isMatched` flags credit each log to the OLDEST open item
 * of the stage, so a week of recorded work read as "7 पैकी 0". The last block drives the week through the REAL
 * bucket builder and matcher (`buildFertigationBucket`) with recent logs only.
 */
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../domain/types/log.types';
import type { ExecutedItem, ExecutionBucket, PlannedItem, PlotComparisonSummary } from '../../../types';
import type { PlannedTaskDerived } from '../../scheduler/planning/ClientPlanEngine';
import { buildPlotWeek, MAX_TODO_ROWS, weekBarTone } from '../compareWeek';
import { executedLabelMr, plannedLabelMr, relativeDayMr } from '../compareText';
import { buildFertigationBucket } from '../plotComparisonService';

// `isMatched` is set the way the stage-wide pass would leave it; the week must NOT read it.
const item = (id: string, name: string, expectedDay: number, isMatched = false): PlannedItem =>
    ({ id, name, expectedDay, frequency: 'Once', isMatched, status: isMatched ? 'COMPLETED' : 'MISSED' }) as PlannedItem;
const work = (id: string, name: string, executedDay: number): ExecutedItem =>
    ({ id, sourceLogId: `log-${id}`, sourceEventId: id, name, executedDate: '', executedDay, isMatchedToPlan: false, isExtra: false });

const bucket = (bucketType: ExecutionBucket['bucketType'], planned: PlannedItem[], executed: ExecutedItem[] = []): ExecutionBucket =>
    ({ bucketType, bucketLabel: '', planned, executed, plannedCount: planned.length, executedCount: executed.length, matchedCount: 0, missedCount: 0, extraCount: 0, health: 'ON_TRACK' }) as ExecutionBucket;

const summary = (currentDay: number, buckets: ExecutionBucket[]): PlotComparisonSummary =>
    ({
        plotId: 'p1', plotName: 'सोनाका', cropId: 'c1', cropName: 'द्राक्ष', referenceDate: '2026-09-01', currentDay,
        stages: [{ stageId: 's1', stageName: 'वाढ', stageCode: 'VEGETATIVE', plannedStartDay: 0, plannedEndDay: 90, status: 'IN_PROGRESS', completionPercent: 0, buckets, issues: [] }],
        overallHealth: 'GOOD', overallCompletionPercent: 0, totalPlanned: 0, totalExecuted: 0, totalMissed: 0, totalExtra: 0, actualCostSpent: 0,
    }) as unknown as PlotComparisonSummary;

const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('buildPlotWeek — the last 7 days of a plot against its schedule', () => {
    it('counts only what was due in the 7 days (today included), met by work recorded in the 7 days', () => {
        const week = buildPlotWeek(summary(40, [
            bucket('IRRIGATION', [
                item('w34', 'Drip Irrigation #1', 34), // day 34 = 7th day back → in window
                item('w33', 'Drip Irrigation #2', 33), // 8th day back → older
                item('w40', 'Drip Irrigation #3', 40), // today
                item('w41', 'Drip Irrigation #4', 41), // tomorrow → not yet due
            ], [work('e34', 'Drip - 2hrs', 34), work('e40', 'Drip - 1hrs', 40)]),
            bucket('SPRAY', [item('s38', 'Foliar Spray', 38)]),
        ]));
        expect(week.expected).toBe(3);
        expect(week.done).toBe(2);
        expect(week.percent).toBe(67);
        expect(week.todo).toEqual([{ label: 'फवारणी', count: 1 }]);
        expect(week.olderOpen).toBe(1);
        expect(week.moreTodo).toBe(0);
    });

    it('a stage-wide "matched" flag on an item is NOT a recording in the week — only recorded work counts', () => {
        // the engine flagged the week's items matched (it credited OLDER logs to them): no work in the week → open
        const week = buildPlotWeek(summary(40, [bucket('IRRIGATION', days(34, 40).map(d => item(`w${d}`, `Drip Irrigation #${d}`, d, true)), [work('old', 'Drip - 2hrs', 10)])]));
        expect(week.done).toBe(0);
        expect(week.todo).toEqual([{ label: 'ठिबकने पाणी', count: 7 }]);
    });

    it('work recorded this week meets THIS week\'s items, never the oldest open ones', () => {
        const week = buildPlotWeek(summary(40, [
            bucket('FERTIGATION', days(30, 40).map(d => item(`f${d}`, `Fertigation #${d}`, d)), days(34, 40).map(d => work(`e${d}`, '19:19:19', d))),
        ]));
        expect(week).toMatchObject({ expected: 7, done: 7, percent: 100, todo: [], olderOpen: 4 });
    });

    it('work recorded beyond the week\'s own items still counts for older open work (late is still recorded)', () => {
        const week = buildPlotWeek(summary(40, [
            bucket('SPRAY', [item('s20', 'Foliar Spray #1', 20), item('s30', 'Foliar Spray #2', 30), item('s38', 'Foliar Spray #3', 38)],
                [work('a', 'मॅन्कोझेब', 38), work('b', 'मॅन्कोझेब', 39)]),
        ]));
        expect(week).toMatchObject({ expected: 1, done: 1, olderOpen: 1 });
    });

    it('nothing due in the 7 days: percent is null (the card shows "—"), never an invented 100%', () => {
        const week = buildPlotWeek(summary(40, [bucket('IRRIGATION', [item('old', 'Drip Irrigation #1', 10)])]));
        expect(week.expected).toBe(0);
        expect(week.percent).toBeNull();
        expect(week.todo).toEqual([]);
        expect(week.olderOpen).toBe(1);
    });

    it('groups the same work into one row with a count, newest first, at most three rows, the rest counted', () => {
        const week = buildPlotWeek(summary(40, [
            bucket('IRRIGATION', [36, 37, 38, 39, 40].map(d => item(`w${d}`, `Drip Irrigation #${d}`, d))),
            bucket('SPRAY', [item('s35', 'Foliar Spray', 35)]),
            bucket('FERTIGATION', [item('f39', 'Fertigation #2', 39)]),
            bucket('ACTIVITY', [item('a34', 'Manual Weeding', 34), item('p34', 'Pruning', 34)]),
        ]));
        expect(week.todo).toHaveLength(MAX_TODO_ROWS);
        // newest first: water (day 40) → खत (39) → फवारणी (35); weeding + pruning (day 34) do not fit
        expect(week.todo).toEqual([
            { label: 'ठिबकने पाणी', count: 5 },
            { label: 'खत देणे', count: 1 },
            { label: 'फवारणी', count: 1 },
        ]);
        expect(week.moreTodo).toBe(2);
        expect(week.percent).toBe(0);
    });

    it('never marks the summary the details below still read', () => {
        const planned = [item('w40', 'Drip Irrigation #1', 40)];
        const executed = [work('e40', 'Drip - 2hrs', 40)];
        buildPlotWeek(summary(40, [bucket('IRRIGATION', planned, executed)]));
        expect(planned[0].isMatched).toBe(false);
        expect(executed[0].isMatchedToPlan).toBe(false);
    });

    it('the bar colour follows the approved thresholds', () => {
        expect(weekBarTone(100)).toBe('green');
        expect(weekBarTone(80)).toBe('green');
        expect(weekBarTone(60)).toBe('amber');
        expect(weekBarTone(20)).toBe('rose');
    });
});

/*
 * The REAL bucket builder and matcher. Day 0 = 2026-01-01; "today" is day 30 (2026-01-31). Fertigation is due
 * every day of a stage that began on day 0 — 31 items — and he recorded fertigation on each of the last 7
 * days only (he started using the app a week ago: the normal pilot case).
 */
const REFERENCE = '2026-01-01';
const dayKey = (d: number) => `2026-01-${String(d + 1).padStart(2, '0')}`;
const dailyFertigation: PlannedTaskDerived[] = days(0, 30).map(d => ({
    id: `plan_fert_day_${d}`, originalId: 'pe_fert', type: 'PERIODIC', operationId: 'op_fert_gen', category: 'FERTIGATION',
    name: `Fertigation #${d + 1}`, isDueToday: d === 30, dueDate: d,
}));
const logOn = (d: number, n = 1): DailyLog => ({
    id: `log-${d}`, date: dayKey(d),
    inputs: Array.from({ length: n }, (_, i) => ({ id: `in-${d}-${i}`, method: 'Drip', productName: '19:19:19', mix: [] })),
}) as unknown as DailyLog;

describe('buildPlotWeek — through the REAL engine bucket (I14-V2-01)', () => {
    it('7 days recorded → "7 पैकी 7", nothing to do, and the 24 older items only counted', () => {
        const engine = buildFertigationBucket(dailyFertigation, days(24, 30).map(d => logOn(d)), REFERENCE);
        // what the old card read: the engine credited the week's 7 logs to days 0–6
        expect(engine.planned.filter(p => p.isMatched).map(p => p.expectedDay)).toEqual(days(0, 6));

        const week = buildPlotWeek(summary(30, [engine]));
        expect(week).toEqual({ expected: 7, done: 7, percent: 100, todo: [], moreTodo: 0, olderOpen: 24 });
    });

    it('5 of the last 7 days recorded → "7 पैकी 5" and only the two unrecorded days to do', () => {
        const engine = buildFertigationBucket(dailyFertigation, days(24, 28).map(d => logOn(d)), REFERENCE);
        const week = buildPlotWeek(summary(30, [engine]));
        expect(week).toMatchObject({ expected: 7, done: 5, percent: 71, todo: [{ label: 'खत देणे', count: 2 }], olderOpen: 24 });
    });

    it('two catch-up feeds recorded today beyond the week\'s own items count against the older open items', () => {
        const engine = buildFertigationBucket(dailyFertigation, [...days(24, 29).map(d => logOn(d)), logOn(30, 3)], REFERENCE);
        const week = buildPlotWeek(summary(30, [engine]));
        expect(week).toMatchObject({ expected: 7, done: 7, olderOpen: 22 });
    });
});

describe('compareText — Marathi on the farmer screen, never the engine English', () => {
    it('names every engine operation in Marathi and falls back to the kind of work', () => {
        expect(plannedLabelMr('Drip Irrigation #11', 'IRRIGATION')).toBe('ठिबकने पाणी');
        expect(plannedLabelMr('Pruning', 'ACTIVITY')).toBe('छाटणी');
        expect(plannedLabelMr('Foliar Spray (Routine)', 'SPRAY')).toBe('फवारणी');
        expect(plannedLabelMr('Something New', 'NUTRITION')).toBe('खत');
        expect(plannedLabelMr('op_unknown', 'ACTIVITY')).toBe('काम');
    });

    it('water says the hours he gave; his own words stay his own', () => {
        expect(executedLabelMr('Drip - 2hrs', 'IRRIGATION', 2)).toBe('पाणी 2 तास');
        expect(executedLabelMr('Drip - 0hrs', 'IRRIGATION', 0)).toBe('पाणी');
        expect(executedLabelMr('मॅन्कोझेब', 'SPRAY')).toBe('मॅन्कोझेब');
    });

    it('relative days in words', () => {
        expect(relativeDayMr(0)).toBe('आज');
        expect(relativeDayMr(3)).toBe('3 दिवसांनी');
        expect(relativeDayMr(-5)).toBe('5 दिवसांपूर्वी');
    });
});
