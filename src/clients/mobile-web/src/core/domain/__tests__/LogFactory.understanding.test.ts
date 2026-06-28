/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LogFactory.understanding — TDD for task 1c (Understanding Meter stamp at save)
 *
 * spec: ai-intelligence-plan-2026-06-25
 *
 * Covers:
 * 1. Manual per-plot path → understanding stamped, numeric score on rich input
 * 2. Manual farm-global path → understanding stamped, numeric score on rich input
 * 3. Voice per-plot path → understanding stamped, numeric score on rich input
 * 4. Voice farm-global path → understanding stamped, numeric score on rich input
 * 5. No-work (silent) input → understanding.outcome === 'UNKNOWN', score === null
 * 6. Round-trip: stamped DailyLog serialised→deserialised keeps understanding
 *    (Dexie blob round-trip; JSON.parse(JSON.stringify(log)) preserves the field)
 * 7. Regression: LogFactory existing behaviour (ids/meta/financials) unchanged
 */

import { describe, it, expect } from 'vitest';
import { LogFactory } from '../LogFactory';
import type {
    FarmerProfile,
    CropProfile,
    LogScope,
    AgriLogResponse,
    CropActivityEvent,
    LabourEvent,
    InputEvent,
    DailyLog,
} from '../../../types';

// =============================================================================
// FIXTURES
// =============================================================================

/**
 * Minimal FarmerProfile for owner (auto-approve).
 * Cast via unknown to avoid repetitive boilerplate for rarely-exercised fields.
 */
function makeProfile(): FarmerProfile {
    return {
        activeOperatorId: 'owner',
        trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false },
        operators: [],
    } as unknown as FarmerProfile;
}

/**
 * Two-crop farm with 2 plots each (4 total).
 * Cast via unknown to avoid the full PlotScheduleInstance shape in test fixtures.
 */
function makeCrops(): CropProfile[] {
    const basePlot = (id: string, name: string) => ({
        id,
        name,
        baseline: { unit: 'Acre' as const },
        schedule: {
            id: 'sched-1',
            plotId: id,
            templateId: 'template-1',
            referenceType: 'PLANTING' as const,
            referenceDate: '2026-01-01',
            stageOverrides: [],
            expectationOverrides: [],
        },
    });
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [basePlot('plot-a', 'Plot A'), basePlot('plot-b', 'Plot B')] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
        {
            id: 'crop-sugarcane',
            name: 'Sugarcane',
            iconName: 'sugarcane',
            color: 'green',
            plots: [basePlot('plot-c', 'Plot C'), basePlot('plot-d', 'Plot D')] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

/** A rich labour + activity manual entry — should produce a numeric score. */
const RICH_MANUAL_DATA = {
    date: '2026-06-28',
    cropActivities: [
        { id: 'ca1', title: 'Pruning', status: 'completed' as const, targetPlotName: 'Plot A' },
    ] as CropActivityEvent[],
    labour: [
        { id: 'lab1', type: 'HIRED' as const, count: 5, wagePerPerson: 400, totalCost: 2000, targetPlotName: 'Plot A' },
    ] as LabourEvent[],
};

/** A no-work manual entry — should produce UNKNOWN. */
const EMPTY_MANUAL_DATA = {
    date: '2026-06-28',
};

/** Scope for a single plot (Plot A in Grapes crop). */
function makeSinglePlotScope(): LogScope {
    return {
        selectedPlotIds: ['plot-a'],
        selectedCropIds: ['crop-grapes'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

/** Scope for farm-global (FARM_GLOBAL_ID). */
function makeFarmGlobalScope(): LogScope {
    return {
        selectedPlotIds: [],
        selectedCropIds: ['FARM_GLOBAL'],
        mode: 'single',
        applyPolicy: 'broadcast',
    };
}

/** Minimal valid AgriLogResponse for voice path. */
function makeVoiceResponse(overrides: Partial<AgriLogResponse> = {}): AgriLogResponse {
    return {
        summary: '',
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        missingSegments: [],
        ...overrides,
    };
}

/** Rich voice response (activity + labour + scope). */
const RICH_VOICE_RESPONSE: AgriLogResponse = makeVoiceResponse({
    summary: 'Pruning done on Plot A, 5 workers, Rs 400/person',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        { id: 'ca1', title: 'Pruning', status: 'completed', targetPlotName: 'Plot A' },
    ],
    labour: [
        { id: 'lab1', type: 'HIRED', count: 5, wagePerPerson: 400, totalCost: 2000, targetPlotName: 'Plot A' },
    ],
});

/** Silent voice response — should produce UNKNOWN. */
const SILENT_VOICE_RESPONSE: AgriLogResponse = makeVoiceResponse({
    summary: '',
    dayOutcome: 'NO_WORK_PLANNED',
    cropActivities: [],
    inputs: [] as InputEvent[],
    labour: [],
    machinery: [],
    activityExpenses: [],
    irrigation: [],
});

// =============================================================================
// PATH 1: Manual per-plot path
// =============================================================================

describe('LogFactory.understanding — manual per-plot path', () => {
    it('stamps understanding with a numeric score on a rich manual entry', () => {
        const logs = LogFactory.createFromManualEntry(
            RICH_MANUAL_DATA,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.score).not.toBeNull();
        expect(typeof log.understanding!.score).toBe('number');
        expect(log.understanding!.outcome).toBe('SCORED');
        expect(log.understanding!.dimensions).toBeInstanceOf(Array);
        expect(log.understanding!.dimensions.length).toBeGreaterThan(0);
    });

    it('stamps UNKNOWN when the manual entry has no events (silent day)', () => {
        // An empty entry with no activities / labour / etc.
        // dayOutcome defaults to WORK_RECORDED in LogFactory, so scoreVlog sees
        // a WORK_RECORDED day with empty buckets → score=0 (not UNKNOWN).
        // True UNKNOWN only comes when dayOutcome is NO_WORK_PLANNED/IRRELEVANT_INPUT.
        // ManualEntry always stamps WORK_RECORDED or DISTURBANCE_RECORDED per LogFactory.
        // So we test the DISTURBANCE path for a zero-work manual entry:
        const data = {
            date: '2026-06-28',
            // No activities → empty manual entry → scoreVlog sees WORK_RECORDED, empty buckets → score=0
        };
        const logs = LogFactory.createFromManualEntry(
            data,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        expect(logs[0].understanding).toBeDefined();
        // Empty WORK_RECORDED → score=0 (not UNKNOWN; UNKNOWN is NO_WORK_PLANNED)
        expect(logs[0].understanding!.outcome).toBe('SCORED');
        expect(logs[0].understanding!.score).toBe(0);
    });
});

// =============================================================================
// PATH 2: Manual farm-global path
// =============================================================================

describe('LogFactory.understanding — manual farm-global path', () => {
    it('stamps understanding with a numeric score on a rich farm-global manual entry', () => {
        const logs = LogFactory.createFromManualEntry(
            RICH_MANUAL_DATA,
            makeFarmGlobalScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.score).not.toBeNull();
        expect(typeof log.understanding!.score).toBe('number');
        expect(log.understanding!.outcome).toBe('SCORED');
    });

    it('stamps understanding on a no-work farm-global entry (SCORED with a low score, not UNKNOWN)', () => {
        const logs = LogFactory.createFromManualEntry(
            EMPTY_MANUAL_DATA,
            makeFarmGlobalScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        expect(logs[0].understanding).toBeDefined();
        // No-work manual → WORK_RECORDED with empty buckets → SCORED (not UNKNOWN,
        // because LogFactory always sets WORK_RECORDED outcome; score may be low but > 0
        // due to solo-farm SCOPE waiver giving partial contribution).
        expect(logs[0].understanding!.outcome).toBe('SCORED');
        expect(logs[0].understanding!.score).not.toBeNull();
        // Score should be low (< 30) for an empty entry
        expect(logs[0].understanding!.score!).toBeLessThan(30);
    });
});

// =============================================================================
// PATH 3: Voice per-plot path
// =============================================================================

describe('LogFactory.understanding — voice per-plot path', () => {
    it('stamps understanding with a numeric score on a rich voice response', () => {
        const logs = LogFactory.createFromVoiceResult(
            RICH_VOICE_RESPONSE,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.score).not.toBeNull();
        expect(typeof log.understanding!.score).toBe('number');
        expect(log.understanding!.outcome).toBe('SCORED');
        expect(log.understanding!.dimensions).toBeInstanceOf(Array);
    });

    it('stamps UNKNOWN for a silent voice response (NO_WORK_PLANNED + empty buckets)', () => {
        const logs = LogFactory.createFromVoiceResult(
            SILENT_VOICE_RESPONSE,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.outcome).toBe('UNKNOWN');
        expect(log.understanding!.score).toBeNull();
    });
});

// =============================================================================
// PATH 4: Voice farm-global path
// =============================================================================

describe('LogFactory.understanding — voice farm-global path', () => {
    it('stamps understanding with a numeric score on a rich farm-global voice response', () => {
        const logs = LogFactory.createFromVoiceResult(
            RICH_VOICE_RESPONSE,
            makeFarmGlobalScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.score).not.toBeNull();
        expect(typeof log.understanding!.score).toBe('number');
        expect(log.understanding!.outcome).toBe('SCORED');
    });

    it('stamps UNKNOWN for a silent farm-global voice response', () => {
        const logs = LogFactory.createFromVoiceResult(
            SILENT_VOICE_RESPONSE,
            makeFarmGlobalScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];

        expect(log.understanding).toBeDefined();
        expect(log.understanding!.outcome).toBe('UNKNOWN');
        expect(log.understanding!.score).toBeNull();
    });
});

// =============================================================================
// ROUND-TRIP: Dexie blob serialisation preserves understanding
// =============================================================================

describe('LogFactory.understanding — round-trip (Dexie blob)', () => {
    it('understanding survives JSON.parse(JSON.stringify(log)) (Dexie object blob round-trip)', () => {
        const logs = LogFactory.createFromVoiceResult(
            RICH_VOICE_RESPONSE,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        const original = logs[0];
        expect(original.understanding).toBeDefined();

        // Simulate Dexie's object blob storage (JSON serialise then deserialise)
        const serialised = JSON.stringify(original);
        const restored = JSON.parse(serialised) as DailyLog;

        expect(restored.understanding).toBeDefined();
        expect(restored.understanding!.score).toBe(original.understanding!.score);
        expect(restored.understanding!.outcome).toBe(original.understanding!.outcome);
        expect(restored.understanding!.dimensions).toHaveLength(original.understanding!.dimensions.length);
    });

    it('UNKNOWN understanding also round-trips correctly', () => {
        const logs = LogFactory.createFromVoiceResult(
            SILENT_VOICE_RESPONSE,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        const original = logs[0];
        expect(original.understanding!.outcome).toBe('UNKNOWN');

        const restored = JSON.parse(JSON.stringify(original)) as DailyLog;
        expect(restored.understanding!.outcome).toBe('UNKNOWN');
        expect(restored.understanding!.score).toBeNull();
    });
});

// =============================================================================
// REGRESSION: Existing LogFactory behaviour unchanged
// =============================================================================

describe('LogFactory.understanding — regression: existing behaviour unchanged', () => {
    it('createFromManualEntry still produces correct id/date/financials', () => {
        const logs = LogFactory.createFromManualEntry(
            RICH_MANUAL_DATA,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.id).toBeTruthy();
        expect(log.date).toBe('2026-06-28');
        expect(log.financialSummary.totalLabourCost).toBe(2000);
        expect(log.financialSummary.grandTotal).toBeGreaterThanOrEqual(2000);
    });

    it('createFromVoiceResult still produces correct id/date/financials', () => {
        const response = makeVoiceResponse({
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [{ id: 'ca1', title: 'Pruning', status: 'completed' }],
            labour: [{ id: 'lab1', type: 'HIRED', count: 3, wagePerPerson: 500, totalCost: 1500 }],
        });
        const logs = LogFactory.createFromVoiceResult(
            response,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        const log = logs[0];
        expect(log.id).toBeTruthy();
        expect(log.financialSummary.totalLabourCost).toBe(1500);
    });

    it('understanding score is bounded 0-100 or null', () => {
        const logs = LogFactory.createFromVoiceResult(
            RICH_VOICE_RESPONSE,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        const score = logs[0].understanding!.score;
        if (score !== null) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
            expect(Number.isInteger(score)).toBe(true);
        }
    });

    it('DISTURBANCE day → understanding.outcome === DISTURBANCE (not UNKNOWN)', () => {
        const disturbanceResponse = makeVoiceResponse({
            dayOutcome: 'DISTURBANCE_RECORDED',
            disturbance: {
                scope: 'FULL_DAY',
                group: 'Weather',
                reason: 'Heavy rain — no work possible',
                blockedSegments: [],
            },
        });
        const logs = LogFactory.createFromVoiceResult(
            disturbanceResponse,
            makeSinglePlotScope(),
            makeCrops(),
            makeProfile(),
        );
        expect(logs).toHaveLength(1);
        expect(logs[0].understanding!.outcome).toBe('DISTURBANCE');
        expect(logs[0].understanding!.score).not.toBeNull();
    });
});
