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
}): { captured: Captured; onDataConsumed: ReturnType<typeof vi.fn> } {
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

    return { captured, onDataConsumed };
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
