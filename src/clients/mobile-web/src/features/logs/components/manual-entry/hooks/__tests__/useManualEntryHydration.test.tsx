// @vitest-environment jsdom
/**
 * Regression coverage for the "Entire Farm" voice-bucketing bug.
 *
 * When a farmer records/types a log with NO single plot resolved (the default
 * "Entire Farm" / overview selection), `activePlot` is `undefined`. The old
 * hook bailed at its first line (`if (!activePlot) return;`) so the parsed
 * flat arrays (irrigation / labour / inputs / machinery) were never hydrated
 * into the review screen → "log accepted but no buckets render".
 *
 * These tests assert that a fresh parse (`initialData` present) hydrates the
 * buckets even when `activePlot` is undefined, and that the single-plot path
 * is unchanged.
 *
 * spec: voice-bucketing-hydration-entirefarm-2026-06-10
 */
import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useManualEntryHydration } from '../useManualEntryHydration';
import {
    AgriLogResponse, Plot, IrrigationEvent, LabourEvent, MachineryEvent,
    InputEvent, CropActivityEvent, ActivityExpenseEvent, ObservationNote,
    PlannedTask, DisturbanceEvent, FarmerProfile, LedgerDefaults, DailyLog,
} from '../../../../../../types';
import type { ManualEntryFormOrigin } from '../../types';

/** A populated parse with flat buckets and an empty cropActivities array. */
function makeInitialData(): AgriLogResponse {
    return {
        summary: 'Watered the field and applied fertilizer with 2 labourers.',
        dayOutcome: 'productive' as AgriLogResponse['dayOutcome'],
        cropActivities: [],
        irrigation: [
            {
                id: 'ai_irr_1',
                method: 'drip',
                source: 'Well',
                durationHours: 3,
            } as IrrigationEvent,
        ],
        labour: [
            { type: 'HIRED', count: 2, activity: 'Weeding' } as Partial<LabourEvent>,
        ] as LabourEvent[],
        inputs: [
            {
                type: 'fertilizer',
                productName: 'Urea',
                quantity: 5,
                unit: 'kg',
            } as Partial<InputEvent>,
        ] as InputEvent[],
        machinery: [],
        activityExpenses: [],
        missingSegments: [],
    } as AgriLogResponse;
}

function makePlot(): Plot {
    return {
        id: 'plot_1',
        name: 'North Block',
        baseline: {} as Plot['baseline'],
        schedule: {} as Plot['schedule'],
        infrastructure: { irrigationMethod: 'Drip' } as Plot['infrastructure'],
    } as Plot;
}

const profile = { name: 'Tester' } as FarmerProfile;
const defaults = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: { defaultWage: 0, defaultHours: 0, shifts: [] },
    machinery: { defaultRentalCost: 0, defaultFuelCost: 0 },
} as LedgerDefaults;

interface Captured {
    cropActivities: CropActivityEvent[];
    irrigationMap: Record<string, IrrigationEvent>;
    labourMap: Record<string, LabourEvent>;
    machineryMap: Record<string, MachineryEvent>;
    inputMap: Record<string, InputEvent[]>;
    expenses: ActivityExpenseEvent[];
    observations: ObservationNote[];
    plannedTasks: PlannedTask[];
    disturbance: DisturbanceEvent | undefined;
    transcript: string;
}

/**
 * Drives the hook once and captures the final state pushed through the
 * setters. Setters accept either a value or an updater fn (the hook only
 * passes values, but we resolve both to be safe).
 */
function runHydration(opts: {
    initialData?: AgriLogResponse | null;
    activePlot: Plot | undefined;
    todayLogs?: DailyLog[];
}): {
    captured: Captured;
    onDataConsumed: ReturnType<typeof vi.fn>;
    formOrigin: React.MutableRefObject<ManualEntryFormOrigin>;
} {
    const captured: Captured = {
        cropActivities: [],
        irrigationMap: {},
        labourMap: {},
        machineryMap: {},
        inputMap: {},
        expenses: [],
        observations: [],
        plannedTasks: [],
        disturbance: undefined,
        transcript: '',
    };

    function setter<K extends keyof Captured>(key: K) {
        return (next: Captured[K] | ((prev: Captured[K]) => Captured[K])) => {
            captured[key] = typeof next === 'function'
                ? (next as (prev: Captured[K]) => Captured[K])(captured[key])
                : next;
        };
    }

    const onDataConsumed = vi.fn();
    const hasVoiceDataBeenApplied = { current: false } as React.MutableRefObject<boolean>;
    const initialAiDataRef = { current: null } as React.MutableRefObject<AgriLogResponse | null>;
    const formOrigin = { current: 'blank' } as React.MutableRefObject<ManualEntryFormOrigin>;

    renderHook(() =>
        useManualEntryHydration({
            initialData: opts.initialData,
            activePlot: opts.activePlot,
            defaults,
            profile,
            todayLogs: opts.todayLogs ?? [],
            onDataConsumed,
            hasVoiceDataBeenApplied,
            initialAiDataRef,
            formOriginRef: formOrigin,
            setCropActivities: setter('cropActivities') as React.Dispatch<React.SetStateAction<CropActivityEvent[]>>,
            setIrrigationMap: setter('irrigationMap') as React.Dispatch<React.SetStateAction<Record<string, IrrigationEvent>>>,
            setLabourMap: setter('labourMap') as React.Dispatch<React.SetStateAction<Record<string, LabourEvent>>>,
            setMachineryMap: setter('machineryMap') as React.Dispatch<React.SetStateAction<Record<string, MachineryEvent>>>,
            setInputMap: setter('inputMap') as React.Dispatch<React.SetStateAction<Record<string, InputEvent[]>>>,
            setExpenses: setter('expenses') as React.Dispatch<React.SetStateAction<ActivityExpenseEvent[]>>,
            setObservations: setter('observations') as React.Dispatch<React.SetStateAction<ObservationNote[]>>,
            setPlannedTasks: setter('plannedTasks') as React.Dispatch<React.SetStateAction<PlannedTask[]>>,
            setDisturbance: setter('disturbance') as React.Dispatch<React.SetStateAction<DisturbanceEvent | undefined>>,
            setTranscript: setter('transcript') as React.Dispatch<React.SetStateAction<string>>,
        })
    );

    return { captured, onDataConsumed, formOrigin };
}

describe('useManualEntryHydration — Entire Farm (no single plot)', () => {
    it('hydrates parsed buckets when activePlot is undefined', () => {
        const { captured, onDataConsumed } = runHydration({
            initialData: makeInitialData(),
            activePlot: undefined,
        });

        // Global activity card synthesized.
        expect(captured.cropActivities).toHaveLength(1);
        expect(captured.cropActivities[0].id).toBe('act_global_daily');

        // Flat arrays mapped into the bucket maps under the global card.
        expect(Object.keys(captured.irrigationMap).length).toBeGreaterThan(0);
        expect(captured.irrigationMap['act_global_daily']).toBeDefined();
        expect(captured.irrigationMap['act_global_daily'].method).toBe('drip');

        expect(Object.keys(captured.labourMap).length).toBeGreaterThan(0);
        expect(captured.labourMap['act_global_daily']).toBeDefined();
        expect(captured.labourMap['act_global_daily'].count).toBe(2);

        expect(captured.inputMap['act_global_daily']).toBeDefined();
        expect(captured.inputMap['act_global_daily'].length).toBeGreaterThan(0);
        expect(captured.inputMap['act_global_daily'][0].type).toBe('fertilizer');

        // The parse was consumed (mirrors the single-plot success path).
        expect(onDataConsumed).toHaveBeenCalledTimes(1);
    });

    it('does not throw and produces empty buckets with no initialData and no activePlot', () => {
        const { captured, onDataConsumed } = runHydration({
            initialData: null,
            activePlot: undefined,
        });

        // Nothing to hydrate → no global card, no consume callback.
        expect(captured.cropActivities).toHaveLength(0);
        expect(Object.keys(captured.irrigationMap)).toHaveLength(0);
        expect(onDataConsumed).not.toHaveBeenCalled();
    });
});

describe('useManualEntryHydration — single plot (regression-safe)', () => {
    it('hydrates parsed buckets identically when activePlot is set', () => {
        const { captured, onDataConsumed } = runHydration({
            initialData: makeInitialData(),
            activePlot: makePlot(),
        });

        expect(captured.cropActivities).toHaveLength(1);
        expect(captured.cropActivities[0].id).toBe('act_global_daily');
        expect(captured.irrigationMap['act_global_daily']).toBeDefined();
        expect(captured.irrigationMap['act_global_daily'].method).toBe('drip');
        expect(captured.labourMap['act_global_daily'].count).toBe(2);
        expect(captured.inputMap['act_global_daily'][0].type).toBe('fertilizer');
        expect(onDataConsumed).toHaveBeenCalledTimes(1);
    });
});

/**
 * ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11).
 *
 * Founder-caught bug: the AI fabricated a phrase inside an item's
 * `sourceText`, then extracted a whole cropActivity from its own
 * invention. The backend now stamps `provenanceVerified: false` on any
 * item whose sourceText it could not verify against the transcript. These
 * tests prove the flag survives the hydration step (which hand-builds
 * each bucket item from the raw AI payload — a spot a new field can
 * silently get dropped) and that a MISSING key is never coerced to false.
 */
describe('useManualEntryHydration — provenanceVerified guardrail (spec: dfes-companion-2026-07-11)', () => {
    it('threads provenanceVerified:false through irrigation, labour, inputs, and machinery', () => {
        const initialData: AgriLogResponse = {
            ...makeInitialData(),
            irrigation: [
                { id: 'irr_1', method: 'drip', source: 'Well', durationHours: 3, provenanceVerified: false } as IrrigationEvent,
            ],
            labour: [
                { type: 'HIRED', count: 2, activity: 'Weeding', provenanceVerified: false } as Partial<LabourEvent> as LabourEvent,
            ],
            inputs: [
                { type: 'fertilizer', productName: 'Urea', quantity: 5, unit: 'kg', provenanceVerified: false } as Partial<InputEvent> as InputEvent,
            ],
            machinery: [
                { id: 'mach_1', type: 'tractor', ownership: 'owned', hoursUsed: 2, provenanceVerified: false } as MachineryEvent,
            ],
        };

        const { captured } = runHydration({ initialData, activePlot: makePlot() });

        expect(captured.irrigationMap['act_global_daily'].provenanceVerified).toBe(false);
        expect(captured.labourMap['act_global_daily'].provenanceVerified).toBe(false);
        expect(captured.inputMap['act_global_daily'][0].provenanceVerified).toBe(false);
        expect(captured.machineryMap['act_global_daily'].provenanceVerified).toBe(false);
    });

    it('leaves provenanceVerified undefined (verified) when the backend omits the key', () => {
        const { captured } = runHydration({ initialData: makeInitialData(), activePlot: makePlot() });

        expect(captured.irrigationMap['act_global_daily'].provenanceVerified).toBeUndefined();
        expect(captured.labourMap['act_global_daily'].provenanceVerified).toBeUndefined();
        expect(captured.inputMap['act_global_daily'][0].provenanceVerified).toBeUndefined();
    });

    it('flags the merged global activity card when ANY contributing cropActivity failed verification', () => {
        const initialData: AgriLogResponse = {
            ...makeInitialData(),
            cropActivities: [
                { id: 'act_1', title: 'Weeding', workTypes: ['Weeding'], sourceText: 'खरं वाक्य', provenanceVerified: true } as CropActivityEvent,
                { id: 'act_2', title: 'Pruning', workTypes: ['Pruning'], sourceText: 'त्यांनी बाग छाटून घेतली', provenanceVerified: false } as CropActivityEvent,
            ],
        };

        const { captured } = runHydration({ initialData, activePlot: makePlot() });

        expect(captured.cropActivities[0].provenanceVerified).toBe(false);
        expect(captured.cropActivities[0].workTypes).toEqual(expect.arrayContaining(['Weeding', 'Pruning']));
    });

    it('does not flag the global activity card when every cropActivity is verified', () => {
        const initialData: AgriLogResponse = {
            ...makeInitialData(),
            cropActivities: [
                { id: 'act_1', title: 'Weeding', workTypes: ['Weeding'], sourceText: 'खरं वाक्य', provenanceVerified: true } as CropActivityEvent,
            ],
        };

        const { captured } = runHydration({ initialData, activePlot: makePlot() });

        expect(captured.cropActivities[0].provenanceVerified).toBeUndefined();
    });

    it('threads provenanceVerified through plannedTasks (guardrail)', () => {
        const initialData: AgriLogResponse = {
            ...makeInitialData(),
            plannedTasks: [
                {
                    title: 'Spray next week',
                    category: 'maintenance',
                    sourceText: 'पुढच्या आठवड्यात फवारणी करायची',
                    systemInterpretation: 'Planned spray',
                    provenanceVerified: false,
                },
            ],
        };

        const { captured } = runHydration({ initialData, activePlot: makePlot() });

        expect(captured.plannedTasks[0].provenanceVerified).toBe(false);
    });
});

/**
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — THE ORIGIN MARKER.
 *
 * This hook is the only code that knows whether the form the farmer is looking at was
 * filled by him or filled for him, so it is the code that says so. The save button
 * reads the marker and may claim `source: 'manual'` ONLY for 'blank'; anything else
 * makes no claim and ships nothing, which is the pre-task-0b wire exactly.
 */
function makeSavedLog(partial: Partial<DailyLog>): DailyLog {
    return {
        id: 'log_saved_1',
        date: '2026-08-15',
        context: { selection: [{ cropId: 'crop_1', cropName: 'Grapes', selectedPlotIds: ['plot_1'], selectedPlotNames: ['North Block'] }] },
        ...partial,
    } as unknown as DailyLog;
}

/**
 * WAVE 2.1 — THE FORM MAY NOT INVENT THE FARMER'S WORK.
 * spec: dfes-companion-2026-07-11 (wave-2.1)
 *
 * Doctrine P4: never fabricate — no default fills a bucket the farmer did not fill.
 *
 * Every assertion below used to fail. The overlay hand-built each bucket item with a
 * `|| literal` tail, so a parse that extracted a row but no values still handed the
 * farmer a well, two hours of water, an owned tractor and a 90%-confident observation.
 * Worse, none of it stayed on the screen: `ManualEntry` POSTs the hydrated draft to
 * `/shramsafal/corrections` as the FARMER'S OWN correction of the AI.
 *
 * A bare row is the normal shape of a thin day, not an exotic one — the parse names
 * what it heard and nothing else.
 */
function makePlotWithoutInfrastructure(): Plot {
    return {
        id: 'plot_2',
        name: 'South Block',
        baseline: {} as Plot['baseline'],
        schedule: {} as Plot['schedule'],
        infrastructure: {} as Plot['infrastructure'],
    } as Plot;
}

/** A parse with every bucket emptied, then only the row under test put back. */
function makeBareParse(over: Partial<Record<keyof AgriLogResponse, unknown>>): AgriLogResponse {
    return {
        ...makeInitialData(),
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        observations: [],
        plannedTasks: [],
        ...over,
    } as unknown as AgriLogResponse;
}

describe('useManualEntryHydration — WAVE 2.1 anti-fabrication (spec: dfes-companion-2026-07-11)', () => {
    it('leaves the water source and duration blank when the parse named neither', () => {
        const { captured } = runHydration({
            initialData: makeBareParse({
                irrigation: [{ id: 'irr_1', sourceText: 'पाणी दिलं' }],
            }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        const irr = captured.irrigationMap['act_global_daily'];
        // Not vacuous: the row itself IS hydrated — only its unspoken fields stay empty.
        expect(irr).toBeDefined();
        expect(irr.sourceText).toBe('पाणी दिलं');
        expect(irr.source).toBe('');
        expect(irr.method).toBe('');
        expect(irr.durationHours).toBeUndefined();
    });

    it("still uses the plot's own recorded irrigation hardware as the method", () => {
        // The guard against over-removal. `infrastructure.irrigationMethod` is a fact
        // the farmer entered about THIS plot, not a default the app made up for him.
        const { captured } = runHydration({
            initialData: makeBareParse({
                irrigation: [{ id: 'irr_1', sourceText: 'पाणी दिलं' }],
            }),
            activePlot: makePlot(),
        });

        expect(captured.irrigationMap['act_global_daily'].method).toBe('Drip');
    });

    it('leaves labour type and activity blank when the parse named neither', () => {
        const { captured } = runHydration({
            initialData: makeBareParse({ labour: [{ count: 2 }] }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        const lab = captured.labourMap['act_global_daily'];
        expect(lab.count).toBe(2);
        expect(lab.type).toBeUndefined();
        expect(lab.activity).toBeUndefined();
    });

    it('leaves input type, method and product name blank when the parse named none', () => {
        const { captured } = runHydration({
            initialData: makeBareParse({ inputs: [{ quantity: 5, unit: 'kg' }] }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        const inp = captured.inputMap['act_global_daily'][0];
        expect(inp.quantity).toBe(5);
        expect(inp.type).toBeUndefined();
        expect(inp.method).toBeUndefined();
        expect(inp.mix[0].productName).toBe('');
    });

    it('does not turn an untyped NPK fertiliser into a sprayed pesticide', () => {
        // The `|| 'pesticide'` and the `'Soil' : 'Spray'` pair rewrote WHAT WAS APPLIED,
        // and wave 3.4 classifies the day's work from exactly these two fields.
        const { captured } = runHydration({
            initialData: makeBareParse({
                inputs: [{ productName: '19:19:19', quantity: 5, unit: 'kg' }],
            }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        const inp = captured.inputMap['act_global_daily'][0];
        expect(inp.mix[0].productName).toBe('19:19:19');
        expect(inp.type).not.toBe('pesticide');
        expect(inp.method).not.toBe('Spray');
    });

    it('conjures NO machinery when the parse returned none', () => {
        // The old `else if (hasSpray)` branch invented a whole OWNED TRACTOR running two
        // hours, off nothing but an input row that carried no delivery method.
        const { captured } = runHydration({
            initialData: makeBareParse({
                inputs: [{ type: 'pesticide', productName: 'Confidor', quantity: 250, unit: 'ml' }],
                machinery: [],
            }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        expect(captured.inputMap['act_global_daily']).toHaveLength(1);
        expect(captured.machineryMap).toEqual({});
    });

    it('leaves machinery type, ownership and hours blank when the parse named none', () => {
        const { captured } = runHydration({
            initialData: makeBareParse({
                machinery: [{ id: 'mach_1', sourceText: 'ट्रॅक्टर' }],
            }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        const mach = captured.machineryMap['act_global_daily'];
        expect(mach.sourceText).toBe('ट्रॅक्टर');
        expect(mach.type).toBeUndefined();
        expect(mach.ownership).toBeUndefined();
        expect(mach.hoursUsed).toBeUndefined();
    });

    it('never stamps 90% confidence on an observation the AI did not score', () => {
        // 90 sits above the `< 60` threshold ObservationEventCard uses to render its
        // low-confidence caveat, so the invented number SUPPRESSED the caveat entirely.
        const { captured } = runHydration({
            initialData: makeBareParse({
                observations: [{ textRaw: 'पानं पिवळी पडली' }],
            }),
            activePlot: makePlotWithoutInfrastructure(),
        });

        expect(captured.observations[0].textRaw).toBe('पानं पिवळी पडली');
        expect(captured.observations[0].aiConfidence).toBeUndefined();
    });
});

describe('useManualEntryHydration — form origin (spec: dfes-farmer-facing-deploy-readiness-2026-08-14)', () => {
    it('marks a handed-in AgriLogResponse as prefilled-draft, never as blank', () => {
        // Covers BOTH producers of initialData — a fresh voice parse and mainView's
        // "Edit This Log" conversion. The hook cannot tell them apart, and does not
        // pretend to: it reports only that the farmer did not type this here.
        const { formOrigin, captured } = runHydration({
            initialData: makeInitialData(),
            activePlot: makePlot(),
        });

        expect(captured.labourMap['act_global_daily'].count).toBe(2);
        expect(formOrigin.current).toBe('prefilled-draft');
    });

    it('marks a form filled from today\'s already-saved log as existing-log', () => {
        const { formOrigin, captured } = runHydration({
            initialData: null,
            activePlot: makePlot(),
            todayLogs: [makeSavedLog({
                labour: [{ id: 'ai_lab_1', type: 'HIRED', count: 3, activity: 'Spraying' }],
            } as unknown as Partial<DailyLog>)],
        });

        expect(captured.labourMap['act_global_daily'].count).toBe(3);
        expect(formOrigin.current).toBe('existing-log');
    });

    it('marks a form that nothing filled as blank, so a typed day still ships', () => {
        const { formOrigin, captured } = runHydration({
            initialData: null,
            activePlot: makePlot(),
        });

        expect(Object.keys(captured.labourMap)).toHaveLength(0);
        expect(formOrigin.current).toBe('blank');
    });

    it('stays blank when today\'s log exists but contributed nothing to the form', () => {
        // Presence of a log is not the test — what landed in the form is. Withholding
        // here would cost the farmer his score for a day he really did type out.
        const { formOrigin, captured } = runHydration({
            initialData: null,
            activePlot: makePlot(),
            todayLogs: [makeSavedLog({
                labour: [], irrigation: [], machinery: [], inputs: [],
                cropActivities: [], activityExpenses: [], observations: [], plannedTasks: [],
            } as unknown as Partial<DailyLog>)],
        });

        expect(Object.keys(captured.labourMap)).toHaveLength(0);
        expect(formOrigin.current).toBe('blank');
    });
});
