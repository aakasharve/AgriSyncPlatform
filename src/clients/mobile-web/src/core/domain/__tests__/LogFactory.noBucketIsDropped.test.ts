/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 2b — B1d)
 *
 * "ALL BUCKETS" — the un-split must not lose anything, and must not repeat a
 * quantity to avoid losing it.
 *
 * THE RULE (founder, 2026-08-13). A QUANTITY cannot be repeated without
 * fabricating: eight workers stated once are eight, and copying them onto three
 * plots invents sixteen people (`P4`/`P7`). An OBSERVATION can be repeated,
 * because it is one fact that is true in several places. So every bucket has
 * exactly one honest home in a multi-plot save, and this file walks all of them.
 *
 * TWO LOSSES ARE UNDER TEST HERE.
 *
 *  1. The `hasDayLevelFacts` fix, AUDITED rather than trusted. Phase 2b's own
 *     implementer found that with every event pinned to a plot, no shared record
 *     was built and the disturbance / transcript / stated total vanished. The
 *     fix exists; the question this file answers is whether it covers EVERY
 *     bucket the record builders gate on `carriesDayFacts`, on BOTH the manual
 *     and the voice path.
 *
 *  2. The one Phase 2b explicitly left open: an event pinned to a plot name that
 *     matches no plot of this save was dropped from every record. `!t` is false
 *     because it has a name, `t === name` is false for every plot there is — so
 *     the farmer's five workers were reported "Logged." and then did not exist.
 *     That is silent loss of a farmer-stated quantity on the capture path.
 *
 *     `targetPlotName` has exactly ONE producer in this codebase — the voice
 *     parser's schema. No manual surface writes it. So an unmatched name is an
 *     AI extraction that failed to match the selection, NOT an assertion the
 *     farmer made, and the record's spatial assertion rightly comes from the
 *     plots he selected. The parser's guess rides along on the event untouched
 *     (`P8`), so nothing is invented and nothing disappears.
 */
import { describe, it, expect } from 'vitest';

import { LogFactory } from '../LogFactory';
import type {
    ActivityExpenseEvent,
    AgriLogResponse,
    CropActivityEvent,
    CropProfile,
    DailyLog,
    DisturbanceEvent,
    FarmerProfile,
    InputEvent,
    IrrigationEvent,
    LabourEvent,
    LogScope,
    MachineryEvent,
    ObservationNote,
    PlannedTask,
} from '../../../types';

const CROP_ID = 'crop-grapes';
const PLOT_A = 'plot-a';
const PLOT_B = 'plot-b';
const PLOT_C = 'plot-c';
const DATE = '2026-08-13';

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: [
        { id: PLOT_A, name: 'Plot A' },
        { id: PLOT_B, name: 'Plot B' },
        { id: PLOT_C, name: 'Plot C' },
    ],
} as unknown as CropProfile;

const ownerProfile = { activeOperatorId: 'owner' } as unknown as FarmerProfile;

const threePlots: LogScope = {
    selectedPlotIds: [PLOT_A, PLOT_B, PLOT_C],
    selectedCropIds: [CROP_ID],
    mode: 'multi',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

const onePlot: LogScope = {
    selectedPlotIds: [PLOT_A],
    selectedCropIds: [CROP_ID],
    mode: 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

// ---------------------------------------------------------------------------
// One of every bucket, none of them pinned to a plot.
// ---------------------------------------------------------------------------

const activity = () => ([{ id: 'act-1', title: 'छाटणी', status: 'completed' }] as unknown as CropActivityEvent[]);
/** Passes `isCompletedIrrigationEvent`: a stated duration, no issue text. */
const irrigation = () => ([{ id: 'irr-1', method: 'Drip', source: 'Well', durationHours: 2 }] as unknown as IrrigationEvent[]);
const labour = () => ([{ id: 'lab-1', type: 'HIRED', engagementType: 'hired_daily', count: 8, totalCost: 4000 }] as unknown as LabourEvent[]);
const inputs = () => ([{ id: 'inp-1', type: 'fertilizer', productName: 'Urea', quantity: 25, unit: 'kg', cost: 900 }] as unknown as InputEvent[]);
const machinery = () => ([{ id: 'mac-1', type: 'tractor', ownership: 'rented', hoursUsed: 3, rentalCost: 1500 }] as unknown as MachineryEvent[]);
const expenses = () => ([{ id: 'exp-1', category: 'transport', totalAmount: 300, vendor: 'Rickshaw' }] as unknown as ActivityExpenseEvent[]);
const observations = () => ([{ id: 'obs-1', textRaw: 'पानावर डाग', noteType: 'observation', severity: 'normal' }] as unknown as ObservationNote[]);
const plannedTasks = () => ([{ id: 'task-1', title: 'उद्या फवारणी', status: 'pending', priority: 'normal' }] as unknown as PlannedTask[]);
const disturbance = (): DisturbanceEvent => ({ scope: 'PARTIAL', group: 'weather', reason: 'पाऊस', blockedSegments: [] } as unknown as DisturbanceEvent);

const everyBucket = () => ({
    date: DATE,
    cropActivities: activity(),
    irrigation: irrigation(),
    labour: labour(),
    inputs: inputs(),
    machinery: machinery(),
    activityExpenses: expenses(),
    observations: observations(),
    plannedTasks: plannedTasks(),
    disturbance: disturbance(),
    fullTranscript: 'आज तिन्ही प्लॉटवर काम झालं',
    manualTotalCost: 6700,
});

const voiceResponse = (overrides: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: activity(),
    irrigation: irrigation(),
    labour: labour(),
    inputs: inputs(),
    machinery: machinery(),
    activityExpenses: expenses(),
    observations: observations(),
    plannedTasks: [{ title: 'उद्या फवारणी', category: 'general', sourceText: '', systemInterpretation: '' }],
    disturbance: disturbance(),
    fullTranscript: 'आज तिन्ही प्लॉटवर काम झालं',
    missingSegments: [],
    ...overrides,
} as AgriLogResponse);

const countAcross = (logs: DailyLog[], read: (log: DailyLog) => number): number =>
    logs.reduce((sum, log) => sum + read(log), 0);

// ---------------------------------------------------------------------------

describe('B1d — every bucket survives a three-plot save, exactly once', () => {
    const logs = LogFactory.createFromManualEntry(everyBucket(), threePlots, [grapes], ownerProfile);

    it('produces ONE record: one engagement, one quantity (O-2 must not regress)', () => {
        expect(logs).toHaveLength(1);
        expect(logs[0].context.selection.flatMap(entry => entry.selectedPlotIds))
            .toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    // --- QUANTITIES: stated once, recorded once, never repeated -------------
    it('labour — the stated 8 and the stated ₹4000, once', () => {
        expect(countAcross(logs, log => log.labour.length)).toBe(1);
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.count ?? 0), 0))).toBe(8);
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.totalCost ?? 0), 0))).toBe(4000);
    });

    it('inputs — 25 kg and ₹900, once', () => {
        expect(countAcross(logs, log => log.inputs.length)).toBe(1);
        expect(countAcross(logs, log => log.inputs.reduce((s, e) => s + (e.quantity ?? 0), 0))).toBe(25);
        expect(countAcross(logs, log => log.inputs.reduce((s, e) => s + (e.cost ?? 0), 0))).toBe(900);
    });

    it('machinery — 3 hours and ₹1500, once', () => {
        expect(countAcross(logs, log => log.machinery.length)).toBe(1);
        expect(countAcross(logs, log => log.machinery.reduce((s, e) => s + (e.hoursUsed ?? 0), 0))).toBe(3);
        expect(countAcross(logs, log => log.machinery.reduce((s, e) => s + (e.rentalCost ?? 0), 0))).toBe(1500);
    });

    it('activity expenses — ₹300, once', () => {
        expect(countAcross(logs, log => log.activityExpenses?.length ?? 0)).toBe(1);
        expect(countAcross(logs, log => (log.activityExpenses ?? []).reduce((s, e) => s + (e.totalAmount ?? 0), 0))).toBe(300);
    });

    it('the farmer\'s own stated total — once, not once per plot', () => {
        expect(logs.filter(log => log.manualTotalCost !== undefined)).toHaveLength(1);
        expect(countAcross(logs, log => log.manualTotalCost ?? 0)).toBe(6700);
    });

    // --- WORK RECORDS: one record of the work, not three -------------------
    it('crop activities — recorded once', () => {
        expect(countAcross(logs, log => log.cropActivities.length)).toBe(1);
    });

    it('irrigation — the completed event recorded once', () => {
        expect(countAcross(logs, log => log.irrigation.length)).toBe(1);
    });

    // --- OBSERVATIONS / DAY FACTS: one save, one telling -------------------
    it('observations — present, and the farmer\'s own note is not duplicated', () => {
        const own = logs.flatMap(log => (log.observations ?? []).filter(obs => obs.textRaw === 'पानावर डाग'));
        expect(own).toHaveLength(1);
    });

    it('planned tasks — the stated task survives, once', () => {
        const own = logs.flatMap(log => (log.plannedTasks ?? []).filter(task => task.title === 'उद्या फवारणी'));
        expect(own).toHaveLength(1);
    });

    it('the disturbance — recorded once', () => {
        expect(logs.filter(log => log.disturbance)).toHaveLength(1);
        expect(logs.find(log => log.disturbance)?.disturbance?.reason).toBe('पाऊस');
    });

    it('the transcript — carried once, verbatim', () => {
        const carried = logs.filter(log => log.fullTranscript);
        expect(carried).toHaveLength(1);
        expect(carried[0].fullTranscript).toBe('आज तिन्ही प्लॉटवर काम झालं');
    });
});

describe('B1d — the VOICE path drops nothing either', () => {
    const logs = LogFactory.createFromVoiceResult(voiceResponse(), threePlots, [grapes], ownerProfile);

    it('carries every bucket onto the one record', () => {
        expect(logs).toHaveLength(1);
        const [log] = logs;
        expect(log.cropActivities).toHaveLength(1);
        expect(log.irrigation).toHaveLength(1);
        expect(log.labour).toHaveLength(1);
        expect(log.inputs).toHaveLength(1);
        expect(log.machinery).toHaveLength(1);
        expect(log.activityExpenses).toHaveLength(1);
        expect(log.disturbance?.reason).toBe('पाऊस');
        expect(log.fullTranscript).toBe('आज तिन्ही प्लॉटवर काम झालं');
        expect((log.observations ?? []).some(obs => obs.textRaw === 'पानावर डाग')).toBe(true);
        expect((log.plannedTasks ?? []).some(task => task.title === 'उद्या फवारणी')).toBe(true);
    });

    it('still carries the day facts when EVERY event is pinned to a plot', () => {
        // The case Phase 2b's own test caught: with no unattributed work, the
        // shared record is built only because the day facts demand it.
        const logs = LogFactory.createFromVoiceResult(
            voiceResponse({
                cropActivities: [{ id: 'act-1', title: 'छाटणी', status: 'completed', targetPlotName: 'Plot A' }] as unknown as CropActivityEvent[],
                irrigation: [],
                labour: [{ id: 'lab-1', type: 'HIRED', count: 5, targetPlotName: 'Plot A' }] as unknown as LabourEvent[],
                inputs: [],
                machinery: [],
                activityExpenses: [],
            }),
            threePlots,
            [grapes],
            ownerProfile,
        );

        expect(logs.filter(log => log.disturbance)).toHaveLength(1);
        expect(logs.filter(log => log.fullTranscript)).toHaveLength(1);
        expect(logs.flatMap(log => (log.observations ?? []).filter(obs => obs.textRaw === 'पानावर डाग'))).toHaveLength(1);
    });
});

describe('B1d — an event pinned to a plot this save does NOT have', () => {
    /** The parser heard "Plot Z". The farmer selected A, B and C. */
    const strayLabour = () => ([{
        id: 'lab-z',
        type: 'HIRED',
        engagementType: 'hired_daily',
        count: 5,
        totalCost: 2500,
        targetPlotName: 'Plot Z',
    }] as unknown as LabourEvent[]);

    it('THE HEADLINE: five workers are recorded, not deleted', () => {
        const logs = LogFactory.createFromManualEntry(
            { date: DATE, labour: strayLabour() },
            threePlots,
            [grapes],
            ownerProfile,
        );

        // Before B1d this was `0` — the record existed and was empty.
        expect(countAcross(logs, log => log.labour.length)).toBe(1);
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.count ?? 0), 0))).toBe(5);
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.totalCost ?? 0), 0))).toBe(2500);
    });

    it('keeps what the parser actually heard, beside the value (`P8`)', () => {
        const [log] = LogFactory.createFromManualEntry(
            { date: DATE, labour: strayLabour() },
            threePlots,
            [grapes],
            ownerProfile,
        );

        // The record asserts the plots the farmer SELECTED; the unmatched guess
        // is preserved on the event rather than being promoted or erased.
        expect(log.labour[0].targetPlotName).toBe('Plot Z');
        expect(log.context.selection.flatMap(entry => entry.selectedPlotIds))
            .toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    it('is recorded ONCE — never copied onto each plot of the selection', () => {
        const logs = LogFactory.createFromManualEntry(
            { date: DATE, labour: strayLabour() },
            threePlots,
            [grapes],
            ownerProfile,
        );

        // A quantity cannot be repeated without fabricating. 5 must not become
        // 15 on the way to being rescued.
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.count ?? 0), 0))).toBe(5);
    });

    it('FORCES the shared record to exist, even when other events are pinned', () => {
        // The case that had no home at all: `targeted` is non-empty (Plot A),
        // there is no unattributed work and no day fact, so before B1d the
        // shared record was never built and the stray event had nowhere to go.
        const logs = LogFactory.createFromManualEntry(
            {
                date: DATE,
                labour: [
                    { id: 'lab-a', type: 'HIRED', count: 3, targetPlotName: 'Plot A' } as LabourEvent,
                    ...strayLabour(),
                ],
            },
            threePlots,
            [grapes],
            ownerProfile,
        );

        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.count ?? 0), 0))).toBe(8);
        // Plot A's own record still holds exactly its own 3 — the stray does not
        // leak into it.
        const plotARecord = logs.find(log =>
            log.context.selection.flatMap(entry => entry.selectedPlotIds).join() === PLOT_A);
        expect(plotARecord?.labour.map(event => event.count)).toEqual([3]);
    });

    it('applies to every bucket, not just labour', () => {
        const stray = { targetPlotName: 'Plot Z' };
        const logs = LogFactory.createFromManualEntry(
            {
                date: DATE,
                cropActivities: [{ ...activity()[0], ...stray }] as unknown as CropActivityEvent[],
                irrigation: [{ ...irrigation()[0], ...stray }] as unknown as IrrigationEvent[],
                inputs: [{ ...inputs()[0], ...stray }] as unknown as InputEvent[],
                machinery: [{ ...machinery()[0], ...stray }] as unknown as MachineryEvent[],
                activityExpenses: [{ ...expenses()[0], ...stray }] as unknown as ActivityExpenseEvent[],
            },
            threePlots,
            [grapes],
            ownerProfile,
        );

        expect(countAcross(logs, log => log.cropActivities.length)).toBe(1);
        expect(countAcross(logs, log => log.irrigation.length)).toBe(1);
        expect(countAcross(logs, log => log.inputs.length)).toBe(1);
        expect(countAcross(logs, log => log.machinery.length)).toBe(1);
        expect(countAcross(logs, log => log.activityExpenses?.length ?? 0)).toBe(1);
    });

    it('SINGLE-PLOT too — the dominant path lost this the same way', () => {
        // Deliberately uniform. Applying the rescue only to multi-plot saves
        // would leave the silent deletion live on the path every log in the
        // database takes, and asymmetry is how the next reader recreates it.
        const logs = LogFactory.createFromManualEntry(
            { date: DATE, labour: strayLabour() },
            onePlot,
            [grapes],
            ownerProfile,
        );

        expect(logs).toHaveLength(1);
        expect(logs[0].labour).toHaveLength(1);
        expect(logs[0].labour[0].count).toBe(5);
        expect(logs[0].labour[0].targetPlotName).toBe('Plot Z');
    });

    it('an event pinned to a plot the save DOES have still goes to that plot alone', () => {
        // The rescue must not swallow the rule it sits beside: real per-plot
        // evidence the farmer supplied still produces a per-plot record.
        const logs = LogFactory.createFromManualEntry(
            {
                date: DATE,
                labour: [
                    { id: 'lab-a', type: 'HIRED', count: 5, targetPlotName: 'Plot A' } as LabourEvent,
                    { id: 'lab-b', type: 'HIRED', count: 3, targetPlotName: 'Plot B' } as LabourEvent,
                ],
            },
            threePlots,
            [grapes],
            ownerProfile,
        );

        const byPlot = logs.map(log => ({
            plots: log.context.selection.flatMap(entry => entry.selectedPlotIds),
            workers: log.labour.map(event => event.count),
        }));

        expect(byPlot).toContainEqual({ plots: [PLOT_A], workers: [5] });
        expect(byPlot).toContainEqual({ plots: [PLOT_B], workers: [3] });
        expect(countAcross(logs, log => log.labour.reduce((s, e) => s + (e.count ?? 0), 0))).toBe(8);
    });
});
