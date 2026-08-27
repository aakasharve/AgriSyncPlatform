/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * FINDING F1 — this module had NO test file at all.
 *
 * `buildOversightHeaderInputs` is the ONLY thing that turns a farmer's real
 * records into the four numbers the canonical strip and the waiting drawer
 * report: the approval count, the yesterday-not-closed flag, the plot count
 * and the operator-name map. It is called from exactly two production sites
 * (`AppContent.tsx:107`, `OversightAppPreview.tsx:181`).
 *
 * The review proved the gap the hard way: replacing this function's entire
 * body with `{ plotCount: 0, operatorNameById: {}, unverifiedCount: 0,
 * yesterdayNotClosed: false }` left all 1610 tests green. The
 * `AppHeader` test that was cited as covering it passes `oversightData` as a
 * hand-built prop fixture, so it never executes a line of this file.
 *
 * Every assertion below therefore drives the REAL function with realistic
 * `data.history` / `data.crops` / `operators` / `plannedTasks` shapes and
 * checks a value the all-zeros mutation cannot produce.
 *
 * CLOCK. `buildOversightHeaderInputs` computes "yesterday" internally from
 * `new Date()` — there is no injectable clock on its signature. The time is
 * therefore frozen with fake timers, and the fixture dates are derived from
 * the app's own `getDateKey` service (the same service the function uses),
 * never from a second hand-rolled date implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildOversightHeaderInputs } from '../appContentOversightInputs';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { LogVerificationStatus } from '../../../types';
import type { CropProfile, DailyLog, FarmOperator, PlannedTask } from '../../../types';

/** Mid-morning IST (11:30), deliberately far from any date boundary so the
 * frozen "today"/"yesterday" cannot flip on either side of the IST offset. */
const FROZEN_NOW = new Date('2026-08-20T06:00:00.000Z');

const TODAY = getDateKey(FROZEN_NOW);
const YESTERDAY = getDateKey(new Date(FROZEN_NOW.getTime() - 86_400_000));

interface LogOptions {
    id: string;
    date: string;
    createdByOperatorId?: string;
    verification?: DailyLog['verification'];
}

/** A realistic `data.history` row: one crop-activity record on one plot,
 * shaped the way `LogFactory` writes them (context.selection with both ids
 * and names, `meta.createdAtISO` always present, `meta.createdByOperatorId`
 * OPTIONAL — see `farm.types.ts:325`). */
function log(options: LogOptions): DailyLog {
    return {
        id: options.id,
        date: options.date,
        context: {
            selection: [
                {
                    cropId: 'crop-grapes',
                    cropName: 'द्राक्ष',
                    selectedPlotIds: ['plot-g1'],
                    selectedPlotNames: ['द्राक्ष-१'],
                },
            ],
        },
        cropActivities: [{ id: `${options.id}-act`, title: 'छाटणी' }],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        observations: [],
        meta: {
            createdAtISO: `${options.date}T09:15:00.000Z`,
            ...(options.createdByOperatorId ? { createdByOperatorId: options.createdByOperatorId } : {}),
        },
        ...(options.verification ? { verification: options.verification } : {}),
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
    } as unknown as DailyLog;
}

/** Two crops, four plots — the seeded pilot farm's real shape (Grapes x2 +
 * Sugarcane x2). No `plot.schedule`, so `computeDayState` derives nothing
 * from a template and the day state turns purely on logs and tasks. */
const CROPS: CropProfile[] = [
    {
        id: 'crop-grapes',
        name: 'द्राक्ष',
        iconName: 'Grape',
        color: 'bg-purple-500',
        plots: [
            { id: 'plot-g1', name: 'द्राक्ष-१' },
            { id: 'plot-g2', name: 'द्राक्ष-२' },
        ],
        supportedTasks: [],
        workflow: [],
    },
    {
        id: 'crop-cane',
        name: 'ऊस',
        iconName: 'Sugarcane',
        color: 'bg-green-600',
        plots: [
            { id: 'plot-c1', name: 'ऊस-१' },
            { id: 'plot-c2', name: 'ऊस-२' },
        ],
        supportedTasks: [],
        workflow: [],
    },
] as unknown as CropProfile[];

const OPERATORS: FarmOperator[] = [
    { id: 'op-purvesh', name: 'पुर्वेश', role: 'PRIMARY_OWNER', capabilities: [], isVerifier: true },
    { id: 'op-ramesh', name: 'रमेश', role: 'MUKADAM', capabilities: [], isVerifier: false },
] as unknown as FarmOperator[];

const NEEDS_APPROVAL: DailyLog['verification'] = {
    status: LogVerificationStatus.DRAFT,
    required: true,
};

const ALREADY_VERIFIED: DailyLog['verification'] = {
    status: LogVerificationStatus.VERIFIED,
    required: true,
};

const NO_APPROVAL_REQUIRED: DailyLog['verification'] = {
    status: LogVerificationStatus.DRAFT,
    required: false,
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('buildOversightHeaderInputs — plot count (spec §2.1, "४ प्लॉट")', () => {
    it('sums every plot across every crop, not the number of crops', () => {
        const result = buildOversightHeaderInputs([], CROPS, OPERATORS, []);

        // Two crops, two plots each. A `crops.length` implementation would
        // say 2 and an all-zeros stub would say 0.
        expect(result.plotCount).toBe(4);
    });

    it('counts a crop that has plots even when another crop has none', () => {
        const cropWithNoPlots = { ...CROPS[0], id: 'crop-empty', plots: [] } as unknown as CropProfile;
        const result = buildOversightHeaderInputs([], [CROPS[1], cropWithNoPlots], OPERATORS, []);

        expect(result.plotCount).toBe(2);
    });
});

describe('buildOversightHeaderInputs — operator names (spec §P-F, no fabricated people)', () => {
    it('maps every operator id to the name actually recorded for it', () => {
        const result = buildOversightHeaderInputs([], CROPS, OPERATORS, []);

        expect(result.operatorNameById).toEqual({
            'op-purvesh': 'पुर्वेश',
            'op-ramesh': 'रमेश',
        });
    });

    it('a record whose creator was never captured adds NO entry to the map', () => {
        // spec §P-F: "absent means not recorded, and never licenses a
        // guess." The record still exists and still counts elsewhere — it
        // just cannot name anybody.
        const history = [
            log({ id: 'log-attributed', date: TODAY, createdByOperatorId: 'op-ramesh' }),
            log({ id: 'log-unattributed', date: TODAY }),
        ];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(Object.keys(result.operatorNameById).sort()).toEqual(['op-purvesh', 'op-ramesh']);
        expect(Object.values(result.operatorNameById)).not.toContain('');
    });

    it('a creator id that is on a record but not in the operator list stays unnamed', () => {
        // The map is built from the operator LIST, never from log ids, so a
        // stale/unknown creator id resolves to nothing rather than to an
        // invented name. `oversightSelectors.ts` then renders that row as
        // `अज्ञात`.
        const history = [log({ id: 'log-ghost', date: TODAY, createdByOperatorId: 'op-not-on-this-farm' })];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result.operatorNameById['op-not-on-this-farm']).toBeUndefined();
        expect(Object.keys(result.operatorNameById)).toHaveLength(2);
    });

    it('an empty operator list yields an empty map, never a placeholder person', () => {
        const result = buildOversightHeaderInputs([], CROPS, [], []);

        expect(result.operatorNameById).toEqual({});
    });
});

describe('buildOversightHeaderInputs — outstanding approvals (spec §3 decision row)', () => {
    it('counts only records whose approval is REQUIRED and still outstanding', () => {
        const history = [
            log({ id: 'log-1', date: TODAY, verification: NEEDS_APPROVAL, createdByOperatorId: 'op-ramesh' }),
            log({ id: 'log-2', date: TODAY, verification: NEEDS_APPROVAL }),
            log({ id: 'log-3', date: TODAY, verification: ALREADY_VERIFIED, createdByOperatorId: 'op-ramesh' }),
            log({ id: 'log-4', date: TODAY, verification: NO_APPROVAL_REQUIRED }),
            log({ id: 'log-5', date: TODAY }),
        ];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        // Only log-1 and log-2: required AND not yet verified. A verified
        // one, a not-required one and one with no verification block at all
        // are all excluded.
        expect(result.unverifiedCount).toBe(2);
    });

    it('counts an outstanding record whose creator was never captured — unknown is not none', () => {
        const history = [log({ id: 'log-nobody', date: TODAY, verification: NEEDS_APPROVAL })];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result.unverifiedCount).toBe(1);
    });

    it('counts outstanding records from every date, not just today', () => {
        const history = [
            log({ id: 'log-old', date: '2026-07-01', verification: NEEDS_APPROVAL }),
            log({ id: 'log-yesterday', date: YESTERDAY, verification: NEEDS_APPROVAL }),
            log({ id: 'log-today', date: TODAY, verification: NEEDS_APPROVAL }),
        ];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result.unverifiedCount).toBe(3);
    });

    it('reports zero when every required approval has been given', () => {
        const history = [
            log({ id: 'log-1', date: TODAY, verification: ALREADY_VERIFIED }),
            log({ id: 'log-2', date: YESTERDAY, verification: ALREADY_VERIFIED }),
        ];

        expect(buildOversightHeaderInputs(history, CROPS, OPERATORS, []).unverifiedCount).toBe(0);
    });
});

describe('buildOversightHeaderInputs — yesterday not closed (spec §4.2)', () => {
    it('is TRUE when yesterday still holds an unverified record', () => {
        const history = [log({ id: 'log-yesterday', date: YESTERDAY, createdByOperatorId: 'op-ramesh' })];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result.yesterdayNotClosed).toBe(true);
    });

    it('is FALSE once yesterday\'s records are all verified', () => {
        const history = [
            log({ id: 'log-yesterday', date: YESTERDAY, verification: ALREADY_VERIFIED, createdByOperatorId: 'op-ramesh' }),
        ];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result.yesterdayNotClosed).toBe(false);
    });

    it('is TRUE when a task was due on or before yesterday and is still pending', () => {
        const tasks = [
            {
                id: 'task-1',
                title: 'पाणी द्या',
                plotId: 'plot-g1',
                cropId: 'crop-grapes',
                dueDate: YESTERDAY,
                priority: 'normal',
                status: 'pending',
                sourceType: 'manual',
            },
        ] as unknown as PlannedTask[];

        expect(buildOversightHeaderInputs([], CROPS, OPERATORS, tasks).yesterdayNotClosed).toBe(true);
    });

    it('is FALSE when that same task is done', () => {
        const tasks = [
            {
                id: 'task-1',
                title: 'पाणी द्या',
                plotId: 'plot-g1',
                cropId: 'crop-grapes',
                dueDate: YESTERDAY,
                priority: 'normal',
                status: 'done',
                sourceType: 'manual',
            },
        ] as unknown as PlannedTask[];

        expect(buildOversightHeaderInputs([], CROPS, OPERATORS, tasks).yesterdayNotClosed).toBe(false);
    });

    it('ignores an unverified record dated TODAY — the flag is about yesterday', () => {
        const history = [log({ id: 'log-today', date: TODAY, createdByOperatorId: 'op-ramesh' })];

        // Today's unverified work is not yet late; the "day not closed"
        // decision row is specifically yesterday's. A function that read
        // today's date would return true here.
        expect(buildOversightHeaderInputs(history, CROPS, OPERATORS, []).yesterdayNotClosed).toBe(false);
    });
});

describe('buildOversightHeaderInputs — the empty case', () => {
    it('reports honest zeros and no flag when the farmer has nothing at all', () => {
        const result = buildOversightHeaderInputs([], [], [], []);

        expect(result).toEqual({
            plotCount: 0,
            operatorNameById: {},
            unverifiedCount: 0,
            yesterdayNotClosed: false,
        });
    });
});

describe('buildOversightHeaderInputs — a whole realistic farm at once', () => {
    it('derives all four values together from one history, and none of them is zero', () => {
        // The end-to-end shape the drawer actually renders: yesterday left
        // unfinished, two approvals outstanding, four plots, two named
        // people — plus one record nobody was recorded for.
        const history = [
            log({ id: 'log-a', date: YESTERDAY, verification: NEEDS_APPROVAL, createdByOperatorId: 'op-ramesh' }),
            log({ id: 'log-b', date: TODAY, verification: NEEDS_APPROVAL, createdByOperatorId: 'op-purvesh' }),
            log({ id: 'log-c', date: TODAY, verification: ALREADY_VERIFIED }),
            log({ id: 'log-d', date: TODAY }),
        ];

        const result = buildOversightHeaderInputs(history, CROPS, OPERATORS, []);

        expect(result).toEqual({
            plotCount: 4,
            operatorNameById: { 'op-purvesh': 'पुर्वेश', 'op-ramesh': 'रमेश' },
            unverifiedCount: 2,
            yesterdayNotClosed: true,
        });
    });
});
