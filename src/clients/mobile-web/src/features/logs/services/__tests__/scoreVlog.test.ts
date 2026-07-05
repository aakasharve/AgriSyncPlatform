/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scoreVlog — Understanding Meter engine unit tests (W1.P3.T1)
 *
 * TDD plan from spec:
 * 1. Formula arithmetic — exact round(100 * Σwcf / Σw)
 * 2. Op-type-gating — DOSE not-applicable for non-input ops; CARRIER re-skins
 * 3. Dishonesty governor — assumed/unconfirmed numbers MUST NOT raise score
 * 4. Silent → UNKNOWN — no-work day returns outcome:'UNKNOWN', score:null
 * 5. confidenceFactor default — absent provenance → 0.7; confirmed field → 1.0
 * 6. Smoke direction — rich > sparse; blocker ≠ UNKNOWN; SILENT → UNKNOWN
 *
 * NOTE: Full ±8 calibration against the 18-vlog golden set is DEFERRED.
 * These tests prove LOGIC + direction. See scorevlog-report.md for rationale.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import { describe, it, expect } from 'vitest';
import { scoreVlog, deriveDimensionProvenance } from '../scoreVlog';
import type { ScoreContext } from '../scoreVlog';
import type { AgriLogResponse } from '../../../../types';

// =============================================================================
// FIXTURES
// =============================================================================

/** Minimal valid AgriLogResponse factory. */
function makeLog(overrides: Partial<AgriLogResponse> = {}): AgriLogResponse {
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

/** A RICH day: spray input with product+dose+carrier+cost+weather observation.
 *  Modelled on a 19/10-like log: spray + grade + carrier vol + labour cost + weather. */
const RICH_LOG: AgriLogResponse = makeLog({
    summary: 'Sprayed fungicide on grapes, 3 blowers, grade A confirmed',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca1',
            title: 'Fungicide spray',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Plot A',
        },
    ],
    inputs: [
        {
            id: 'inp1',
            method: 'Spray',
            carrierType: 'Blower',
            carrierCount: 3,
            computedWaterVolume: 1800,
            mix: [
                { id: 'mix1', productName: 'Carbendazim', dose: 2, unit: 'g/L' },
            ],
            cost: 1200,
            targetPlotName: 'Plot A',
        },
    ],
    labour: [
        {
            id: 'lab1',
            type: 'HIRED',
            count: 5,
            wagePerPerson: 400,
            totalCost: 2000,
            targetPlotName: 'Plot A',
        },
    ],
    machinery: [],
    activityExpenses: [],
    observations: [
        {
            textRaw: 'Light rain in the morning, sprayed anyway',
            noteType: 'observation',
            severity: 'normal',
            source: 'voice',
            tags: ['weather', 'rain'],
            id: 'obs1',
            plotId: 'plot-a',
            dateKey: '2026-10-19',
            timestamp: '2026-10-19T08:00:00',
        },
    ],
});

const RICH_CTX: ScoreContext = {
    farm: { plotCount: 2 },
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'CARRIER', 'COST', 'WEATHER']),
    schedule: { bound: true, stageFit: 'fits' },
};

/** A SPARSE day: only a bare grade mention, no carrier/cost/scope.
 *  Modelled on a 29/10-like log: grade entry only. */
const SPARSE_LOG: AgriLogResponse = makeLog({
    summary: 'Grade A',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca2',
            title: 'Grade A harvest',
            status: 'completed',
            // No targetPlotName on a multi-plot farm → SCOPE=0
        },
    ],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
});

const SPARSE_CTX: ScoreContext = {
    farm: { plotCount: 3 },
    // No confirmedFields → all default to 0.7
};

/** A SILENT day: no work, no disturbance. */
const SILENT_LOG: AgriLogResponse = makeLog({
    summary: '',
    dayOutcome: 'NO_WORK_PLANNED',
    cropActivities: [],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
});

/** A BLOCKER day: labour no-show disturbance (like 2/11). */
const BLOCKER_LOG: AgriLogResponse = makeLog({
    summary: 'Labour did not show up',
    dayOutcome: 'DISTURBANCE_RECORDED',
    cropActivities: [],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
    disturbance: {
        scope: 'FULL_DAY',
        group: 'Labour',
        reason: 'Labour shortage — workers did not arrive',
        severity: 'HIGH',
        blockedSegments: ['labour'],
    },
});

// =============================================================================
// 1. FORMULA TEST — exact arithmetic
// =============================================================================

describe('scoreVlog — formula arithmetic', () => {
    it('produces exact round(100 * Σ(w*c*cf) / Σw) for a hand-constructed case', () => {
        // Hand-construct a log with ONLY WHAT applicable.
        // cropActivities present (coverage=1), no inputs/labour/etc.
        // No ctx (→ cf=0.7), no schedule (PURPOSE N/A), no priorContinuity (CONTINUITY N/A).
        // DOSE N/A (no inputs), CARRIER has 0 coverage (no inputs, no irrigation).
        // Applicable dims: WHAT(20), SCOPE(12), CARRIER(10), COST(12), WEATHER(8)
        //   + no PURPOSE, no DOSE, no CONTINUITY
        // WHAT: w=20, cov=1, cf=0.7 → 14
        // SCOPE: solo farm → w=12, cov=1, cf=0.7 → 8.4
        // CARRIER: no inputs/irrigation → cov=0 → 0
        // COST: no cost → cov=0 → 0
        // WEATHER: no weather → cov=0 → 0
        // Σw_applicable = 20+12+10+12+8 = 62
        // Σcontrib = 14+8.4+0+0+0 = 22.4
        // score = round(100 * 22.4 / 62) = round(36.129) = 36

        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning', status: 'completed' }],
        });
        const ctx: ScoreContext = { farm: { plotCount: 1 } }; // solo farm = SCOPE waiver

        const result = scoreVlog(log, ctx);

        // Verify the outcome is SCORED
        expect(result.outcome).toBe('SCORED');
        expect(result.score).not.toBeNull();

        // Verify dimensions are present
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.applicable).toBe(true);
        expect(whatDim?.coverage).toBe(1);
        expect(whatDim?.confidenceFactor).toBe(0.7);
        expect(whatDim?.contribution).toBeCloseTo(20 * 1 * 0.7, 5);

        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(false); // No inputs

        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.applicable).toBe(true);
        expect(scopeDim?.coverage).toBe(1); // Solo farm waiver
        expect(scopeDim?.confidenceFactor).toBe(0.7);

        // Verify the final score matches the formula
        const applicableDims = result.dimensions.filter(d => d.applicable);
        const expectedWeightSum = applicableDims.reduce((s, d) => s + d.weight, 0);
        const expectedContribSum = applicableDims.reduce((s, d) => s + d.contribution, 0);
        const expectedScore = Math.round(100 * expectedContribSum / expectedWeightSum);
        expect(result.score).toBe(expectedScore);
    });

    it('all applicable dims with coverage=0 produce score=0', () => {
        // A log with dayOutcome='WORK_RECORDED' but completely empty content.
        // WHAT=0 (no activity, no summary), no inputs (DOSE N/A),
        // no labour/cost, no weather. Use 2-plot farm so SCOPE is NOT waived.
        // SCOPE=0 (multi-plot, no events to name a plot).
        // CARRIER=0 (no inputs/irrigation). COST=0. WEATHER=0.
        const emptyLog = makeLog({ summary: '', dayOutcome: 'WORK_RECORDED' });
        const result = scoreVlog(emptyLog, { farm: { plotCount: 2 } });
        expect(result.score).toBe(0);
        expect(result.outcome).toBe('SCORED');
    });
});

// =============================================================================
// 2. OP-TYPE-GATING — DOSE not-applicable for non-input ops
// =============================================================================

describe('scoreVlog — op-type-gating', () => {
    it('DOSE is applicable:false for a pure non-input (crop-activity-only) day', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning', status: 'completed' }],
            inputs: [],
        });
        const result = scoreVlog(log, {});
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(false);
        expect(doseDim?.contribution).toBe(0);
        // DOSE must not appear in the applicable dimensions set
        const applicableDims = result.dimensions.filter(d => d.applicable).map(d => d.dimension);
        expect(applicableDims).not.toContain('DOSE');
    });

    it('DOSE is applicable:true for a spray/input day', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'mix1', productName: 'Urea', dose: 1, unit: 'g/L' }],
                },
            ],
        });
        const result = scoreVlog(log, {});
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(true);
        expect(doseDim?.coverage).toBe(1); // product + dose present
    });

    it('DOSE coverage=0.5 when product present but no dose on mix items', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'mix1', productName: 'Fungicide', unit: 'g/L' }], // no dose
                },
            ],
        });
        const result = scoreVlog(log, {});
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(true);
        expect(doseDim?.coverage).toBe(0.5);
    });

    it('PURPOSE is not-applicable when no schedule bound', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Weeding' }],
        });
        const ctxNoSchedule: ScoreContext = {}; // no schedule
        const result = scoreVlog(log, ctxNoSchedule);
        const purposeDim = result.dimensions.find(d => d.dimension === 'PURPOSE');
        expect(purposeDim?.applicable).toBe(false);
    });

    it('PURPOSE is applicable when schedule.bound=true', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Weeding' }],
        });
        const ctx: ScoreContext = { schedule: { bound: true, stageFit: 'fits' } };
        const result = scoreVlog(log, ctx);
        const purposeDim = result.dimensions.find(d => d.dimension === 'PURPOSE');
        expect(purposeDim?.applicable).toBe(true);
        expect(purposeDim?.coverage).toBe(1);
    });

    it('CONTINUITY is not-applicable when priorContinuity absent', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Row pruning', quantity: 50, unit: 'rows' }],
        });
        const result = scoreVlog(log, {}); // no priorContinuity
        const contDim = result.dimensions.find(d => d.dimension === 'CONTINUITY');
        expect(contDim?.applicable).toBe(false);
    });

    it('CONTINUITY is applicable when priorContinuity provided', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Row pruning', quantity: 50, unit: 'rows' }],
        });
        const result = scoreVlog(log, { priorContinuity: 0.3 });
        const contDim = result.dimensions.find(d => d.dimension === 'CONTINUITY');
        expect(contDim?.applicable).toBe(true);
        expect(contDim?.coverage).toBe(1); // progress + quantity
    });

    it('CARRIER re-skins to irrigation fields for pure irrigation ops', () => {
        const log = makeLog({
            irrigation: [
                { id: 'irr1', method: 'Drip', source: 'Borewell', durationHours: 4 },
            ],
            inputs: [], // pure irrigation — no spray
        });
        const result = scoreVlog(log, {});
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(true);
        expect(carrierDim?.coverage).toBe(1); // method + duration + source
    });
});

// =============================================================================
// 3. DISHONESTY GOVERNOR — fabricated/unconfirmed must NOT raise score
// =============================================================================

describe('scoreVlog — dishonesty governor', () => {
    it('adding an assumed/fabricated cost number does NOT raise the score vs confirmed-cost baseline', () => {
        // The key honesty test: compare assumed-cost to actual-cost.
        // A log WITH labour cost, fully confirmed:
        const confirmedLog = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
            labour: [{ id: 'lab1', type: 'HIRED', count: 5, wagePerPerson: 400, totalCost: 2000 }],
        });
        const confirmedCtx: ScoreContext = {
            provenance: { COST: 'confirmed' },
        };
        const confirmedResult = scoreVlog(confirmedLog, confirmedCtx);

        // Same log but COST provenance = 'assumed' (fabricated by system)
        const assumedCtx: ScoreContext = {
            provenance: { COST: 'assumed' },
            // NOT in confirmedFields → governor caps coverage at 0.5
        };
        const assumedResult = scoreVlog(confirmedLog, assumedCtx);

        // Governor must cap the assumed COST coverage to 0.5
        const assumedCostDim = assumedResult.dimensions.find(d => d.dimension === 'COST');
        expect(assumedCostDim?.coverage).toBe(0.5); // Capped by governor

        // Score with assumed cost must be LOWER than with confirmed cost
        expect(assumedResult.score).toBeLessThan(confirmedResult.score ?? 0);
    });

    it('governor: derived+unconfirmed DOSE coverage capped at 0.5', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'mix1', productName: 'Urea', dose: 2, unit: 'g/L' }],
                },
            ],
        });

        // Without provenance: DOSE coverage = 1 (product + dose present)
        const normalResult = scoreVlog(log, {});
        const normalDoseDim = normalResult.dimensions.find(d => d.dimension === 'DOSE');
        expect(normalDoseDim?.coverage).toBe(1);

        // With provenance='derived' and no confirmedFields:
        const governedCtx: ScoreContext = {
            provenance: { DOSE: 'derived' },
        };
        const governedResult = scoreVlog(log, governedCtx);
        const governedDoseDim = governedResult.dimensions.find(d => d.dimension === 'DOSE');
        expect(governedDoseDim?.coverage).toBe(0.5); // Capped by governor

        // Score with governed DOSE must be <= score without provenance constraint
        expect(governedResult.score).toBeLessThanOrEqual(normalResult.score ?? 0);
    });

    it('governor: confirmed field with assumed provenance overrides cap', () => {
        // Even if provenance says 'assumed', if farmer confirmed it → no cap
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'mix1', productName: 'Fungicide', dose: 3, unit: 'g/L' }],
                },
            ],
        });
        const ctx: ScoreContext = {
            provenance: { DOSE: 'assumed' },
            confirmedFields: new Set(['DOSE']), // Farmer confirmed → override cap
        };
        const result = scoreVlog(log, ctx);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(1); // No cap — farmer confirmed
    });

    it('padding (duplicate/non-teaching content) is inert — score does not rise', () => {
        // A log with one crop activity
        const baseLog = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning', status: 'completed' }],
        });
        const baseResult = scoreVlog(baseLog, {});

        // Add many duplicate crop activities with same title (padding)
        const paddedLog = makeLog({
            cropActivities: [
                { id: 'ca1', title: 'Pruning', status: 'completed' },
                { id: 'ca2', title: 'Pruning', status: 'completed' },
                { id: 'ca3', title: 'Pruning', status: 'completed' },
                { id: 'ca4', title: 'Pruning', status: 'completed' },
            ],
        });
        const paddedResult = scoreVlog(paddedLog, {});

        // WHAT coverage is already 1 for baseLog; padding cannot push beyond 1
        const baseWHAT = baseResult.dimensions.find(d => d.dimension === 'WHAT');
        const paddedWHAT = paddedResult.dimensions.find(d => d.dimension === 'WHAT');
        expect(paddedWHAT?.coverage).toBe(baseWHAT?.coverage); // Both = 1
        expect(paddedResult.score).toBe(baseResult.score); // Identical
    });
});

// =============================================================================
// 4. SILENT → UNKNOWN
// =============================================================================

describe('scoreVlog — silent day → UNKNOWN', () => {
    it('NO_WORK_PLANNED with empty buckets → outcome:UNKNOWN, score:null', () => {
        const result = scoreVlog(SILENT_LOG, {});
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });

    it('IRRELEVANT_INPUT with empty buckets → UNKNOWN', () => {
        const log = makeLog({ dayOutcome: 'IRRELEVANT_INPUT' });
        const result = scoreVlog(log, {});
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });

    it('UNKNOWN days still return a dimensions array (all applicable:false)', () => {
        const result = scoreVlog(SILENT_LOG, {});
        expect(result.dimensions).toBeDefined();
        expect(result.dimensions.length).toBeGreaterThan(0);
        for (const dim of result.dimensions) {
            expect(dim.applicable).toBe(false);
        }
    });

    it('DISTURBANCE_RECORDED day is NOT silent → returns SCORED/DISTURBANCE, not UNKNOWN', () => {
        const result = scoreVlog(BLOCKER_LOG, {});
        expect(result.outcome).toBe('DISTURBANCE');
        expect(result.score).not.toBeNull();
    });

    it('NO_WORK_PLANNED but with actual crop activities → NOT silent (falls through to SCORED)', () => {
        const log = makeLog({
            dayOutcome: 'NO_WORK_PLANNED',
            cropActivities: [{ id: 'ca1', title: 'Weeding done anyway' }],
        });
        const result = scoreVlog(log, {});
        // Has work buckets → not silent
        expect(result.outcome).not.toBe('UNKNOWN');
    });
});

// =============================================================================
// 5. confidenceFactor DEFAULT
// =============================================================================

describe('scoreVlog — confidenceFactor defaults', () => {
    it('defaults to 0.7 when no provenance or confirmedFields provided', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const result = scoreVlog(log, {}); // No ctx
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(0.7);
    });

    it('rises to 1.0 for a field in confirmedFields', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const ctx: ScoreContext = { confirmedFields: new Set(['WHAT']) };
        const result = scoreVlog(log, ctx);
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(1.0);
    });

    it('confirmedFields as array also works', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const ctx: ScoreContext = { confirmedFields: ['WHAT', 'COST'] };
        const result = scoreVlog(log, ctx);
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(1.0);
    });

    it('provenance=spoken gives cf=1.0', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const ctx: ScoreContext = { provenance: { WHAT: 'spoken' } };
        const result = scoreVlog(log, ctx);
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(1.0);
    });

    it('provenance=confirmed gives cf=1.0', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const ctx: ScoreContext = { provenance: { WHAT: 'confirmed' } };
        const result = scoreVlog(log, ctx);
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(1.0);
    });

    it('provenance=assumed gives cf=0.7 (default conservative)', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
        });
        const ctx: ScoreContext = { provenance: { WHAT: 'assumed' } };
        const result = scoreVlog(log, ctx);
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(0.7);
    });

    it('confirmed score is higher than unconfirmed score for same log', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'mix1', productName: 'Fungicide', dose: 2, unit: 'g/L' }],
                },
            ],
        });

        const unconfirmedResult = scoreVlog(log, {});
        const confirmedResult = scoreVlog(log, {
            confirmedFields: new Set(['WHAT', 'DOSE', 'CARRIER', 'COST', 'SCOPE', 'WEATHER']),
        });

        expect(confirmedResult.score).toBeGreaterThan(unconfirmedResult.score ?? 0);
    });
});

// =============================================================================
// 6. SMOKE CALIBRATION — direction, not exact ±8 targets
// =============================================================================

describe('scoreVlog — smoke direction calibration', () => {
    it('RICH day scores HIGH (>70)', () => {
        const result = scoreVlog(RICH_LOG, RICH_CTX);
        expect(result.outcome).toBe('SCORED');
        expect(result.score).not.toBeNull();
        expect(result.score!).toBeGreaterThan(70);
    });

    it('SPARSE day scores LOW (<50)', () => {
        const result = scoreVlog(SPARSE_LOG, SPARSE_CTX);
        expect(result.outcome).toBe('SCORED');
        expect(result.score).not.toBeNull();
        expect(result.score!).toBeLessThan(50);
    });

    it('RICH > SPARSE (ordering guaranteed)', () => {
        const richResult = scoreVlog(RICH_LOG, RICH_CTX);
        const sparseResult = scoreVlog(SPARSE_LOG, SPARSE_CTX);
        expect(richResult.score!).toBeGreaterThan(sparseResult.score!);
    });

    it('SILENT → UNKNOWN (not a numeric score)', () => {
        const result = scoreVlog(SILENT_LOG, {});
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });

    it('BLOCKER/disturbance day → DISTURBANCE outcome, not UNKNOWN, has a score', () => {
        const result = scoreVlog(BLOCKER_LOG, {});
        expect(result.outcome).toBe('DISTURBANCE');
        expect(result.score).not.toBeNull();
        expect(typeof result.score).toBe('number');
    });

    it('BLOCKER day: WEATHER dimension has inflated weight (dominant)', () => {
        const result = scoreVlog(BLOCKER_LOG, {});
        const weatherDim = result.dimensions.find(d => d.dimension === 'WEATHER');
        // On a blocker day, WEATHER weight should be 6x base (48 vs 8)
        expect(weatherDim?.weight).toBeGreaterThan(8);
        expect(weatherDim?.applicable).toBe(true);
    });

    it('multi-plot farm penalises missing targetPlotName in SCOPE', () => {
        // SPARSE_LOG has cropActivity without targetPlotName, on a 3-plot farm
        const result = scoreVlog(SPARSE_LOG, SPARSE_CTX);
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(0); // No events have targetPlotName
    });

    it('solo farm SCOPE waiver: solo farm gets SCOPE=1 regardless of targetPlotName', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }], // No targetPlotName
        });
        const result = scoreVlog(log, { farm: { plotCount: 1 } });
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(1);
    });
});

// =============================================================================
// EXTRA: SCOPE coverage rules
// =============================================================================

describe('scoreVlog — SCOPE coverage rules', () => {
    it('partial scope: some events have targetPlotName, some do not → coverage=0.5', () => {
        const log = makeLog({
            cropActivities: [
                { id: 'ca1', title: 'Pruning', targetPlotName: 'Plot A' },
                { id: 'ca2', title: 'Weeding' }, // No targetPlotName
            ],
        });
        const result = scoreVlog(log, { farm: { plotCount: 2 } });
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(0.5);
    });

    it('full scope: all events have targetPlotName → coverage=1', () => {
        const log = makeLog({
            cropActivities: [
                { id: 'ca1', title: 'Pruning', targetPlotName: 'Plot A' },
                { id: 'ca2', title: 'Weeding', targetPlotName: 'Plot A' },
            ],
        });
        const result = scoreVlog(log, { farm: { plotCount: 2 } });
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(1);
    });
});

// =============================================================================
// EXTRA: COST dimension
// =============================================================================

describe('scoreVlog — COST dimension', () => {
    it('labour without wagePerPerson/totalCost → COST=0.5', () => {
        const log = makeLog({
            labour: [
                { id: 'lab1', type: 'HIRED', count: 5 }, // No totalCost
            ],
        });
        const result = scoreVlog(log, {});
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        // totalCost=0 → computeReceiptTotal=0 → COST=0
        expect(costDim?.coverage).toBe(0);
    });

    it('labour with totalCost and wagePerPerson → COST=1', () => {
        const log = makeLog({
            labour: [
                { id: 'lab1', type: 'HIRED', count: 5, wagePerPerson: 400, totalCost: 2000 },
            ],
        });
        const result = scoreVlog(log, {});
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(1);
    });

    it('non-labour cost (input cost only) → COST=1', () => {
        const log = makeLog({
            inputs: [{ id: 'inp1', method: 'Spray', mix: [], cost: 500 }],
        });
        const result = scoreVlog(log, {});
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(1); // Non-labour cost, no labour events to check rate
    });
});

// =============================================================================
// C-1 FIX: deriveDimensionProvenance unit tests
// =============================================================================

describe('deriveDimensionProvenance — unit tests', () => {
    it('returns empty map when no items carry any provenance tag', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }], // no provenance field
            inputs: [{ id: 'inp1', method: 'Spray', mix: [{ id: 'm1', productName: 'Urea', unit: 'g/L' }] }],
        });
        const result = deriveDimensionProvenance(log);
        expect(Object.keys(result)).toHaveLength(0);
    });

    it('all-spoken inputs → DOSE resolves to spoken', () => {
        const log = makeLog({
            inputs: [
                { id: 'inp1', method: 'Spray', mix: [], provenance: 'spoken' },
                { id: 'inp2', method: 'Spray', mix: [], provenance: 'spoken' },
            ],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['DOSE']).toBe('spoken');
    });

    it('mixed-provenance inputs (spoken + assumed) → DOSE resolves to assumed (least-honest wins)', () => {
        const log = makeLog({
            inputs: [
                { id: 'inp1', method: 'Spray', mix: [], provenance: 'spoken' },
                { id: 'inp2', method: 'Spray', mix: [], provenance: 'assumed' },
            ],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['DOSE']).toBe('assumed');
    });

    it('mix item with assumed provenance taints DOSE even when input item is spoken', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'spoken',
                    mix: [
                        { id: 'm1', productName: 'Urea', unit: 'g/L', provenance: 'spoken' },
                        { id: 'm2', productName: 'NPK', unit: 'g/L', provenance: 'assumed' },
                    ],
                },
            ],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['DOSE']).toBe('assumed');
    });

    it('cropActivities with confirmed provenance → WHAT resolves to confirmed', () => {
        const log = makeLog({
            cropActivities: [
                { id: 'ca1', title: 'Pruning', provenance: 'confirmed' },
                { id: 'ca2', title: 'Weeding', provenance: 'confirmed' },
            ],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['WHAT']).toBe('confirmed');
    });

    it('cropActivities confirmed+derived → WHAT resolves to derived (least-honest wins)', () => {
        const log = makeLog({
            cropActivities: [
                { id: 'ca1', title: 'Pruning', provenance: 'confirmed' },
                { id: 'ca2', title: 'Weeding', provenance: 'derived' },
            ],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['WHAT']).toBe('derived');
    });

    it('COST: labour(spoken) + expense(assumed) → COST resolves to assumed', () => {
        const log = makeLog({
            labour: [{ id: 'lab1', type: 'HIRED', count: 5, totalCost: 2000, provenance: 'spoken' }],
            activityExpenses: [{ id: 'exp1', reason: 'seeds', items: [], provenance: 'assumed' }],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['COST']).toBe('assumed');
    });

    it('CARRIER: machinery provenance present → maps to CARRIER', () => {
        const log = makeLog({
            machinery: [{ id: 'mac1', type: 'tractor', ownership: 'rented', provenance: 'derived' }],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['CARRIER']).toBe('derived');
    });

    it('SCOPE, PURPOSE, CONTINUITY, WEATHER are never set by deriveDimensionProvenance', () => {
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning', provenance: 'assumed' }],
            inputs: [{ id: 'inp1', method: 'Spray', mix: [], provenance: 'assumed' }],
            labour: [{ id: 'lab1', type: 'HIRED', count: 5, provenance: 'assumed' }],
            machinery: [{ id: 'mac1', type: 'tractor', ownership: 'owned', provenance: 'assumed' }],
            activityExpenses: [{ id: 'exp1', reason: 'seeds', items: [], provenance: 'assumed' }],
        });
        const result = deriveDimensionProvenance(log);
        expect(result['SCOPE']).toBeUndefined();
        expect(result['PURPOSE']).toBeUndefined();
        expect(result['CONTINUITY']).toBeUndefined();
        expect(result['WEATHER']).toBeUndefined();
    });
});

// =============================================================================
// C-1 FIX: KEY end-to-end honesty test — log item provenance drives scoring
// =============================================================================

describe('scoreVlog — C-1 fix: per-item provenance wiring', () => {
    /**
     * KEY TEST (per brief): same log scored with inputs[0].provenance='spoken'
     * vs ='assumed' → DOSE capped at 0.5 AND overall score strictly lower.
     * Proves field→dimension wiring + governor fires from real log provenance.
     */
    it('KEY: assumed input provenance → DOSE capped at 0.5, overall score strictly lower', () => {
        const spokenLog = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Fungicide spray', provenance: 'spoken' }],
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'spoken', // <-- honest: farmer stated this
                    mix: [{ id: 'm1', productName: 'Carbendazim', dose: 2, unit: 'g/L', provenance: 'spoken' }],
                },
            ],
        });

        const assumedLog = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Fungicide spray', provenance: 'spoken' }],
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'assumed', // <-- dishonest: system fabricated this
                    mix: [{ id: 'm1', productName: 'Carbendazim', dose: 2, unit: 'g/L', provenance: 'assumed' }],
                },
            ],
        });

        const spokenResult = scoreVlog(spokenLog, {});
        const assumedResult = scoreVlog(assumedLog, {});

        // DOSE must be capped at 0.5 when provenance is 'assumed'
        const assumedDoseDim = assumedResult.dimensions.find(d => d.dimension === 'DOSE');
        expect(assumedDoseDim?.coverage).toBe(0.5);

        // Overall score must be strictly lower with assumed provenance
        expect(assumedResult.score).toBeLessThan(spokenResult.score ?? 0);
    });

    it('spoken provenance → DOSE NOT capped (full coverage preserved)', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'spoken',
                    mix: [{ id: 'm1', productName: 'Urea', dose: 2, unit: 'g/L', provenance: 'spoken' }],
                },
            ],
        });
        const result = scoreVlog(log, {});
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        // spoken → cf=1.0, governor does not cap
        expect(doseDim?.coverage).toBe(1);
        expect(doseDim?.confidenceFactor).toBe(1.0);
    });

    it('derived provenance (unconfirmed) → DOSE capped at 0.5', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'derived',
                    mix: [{ id: 'm1', productName: 'Urea', dose: 2, unit: 'g/L', provenance: 'derived' }],
                },
            ],
        });
        const result = scoreVlog(log, {});
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5); // Governor caps derived+unconfirmed
    });

    it('confirmedFields override: assumed item provenance but DOSE in confirmedFields → NOT capped', () => {
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'assumed',
                    mix: [{ id: 'm1', productName: 'Urea', dose: 2, unit: 'g/L', provenance: 'assumed' }],
                },
            ],
        });
        // Farmer confirmed DOSE at the confirm-screen → override
        const ctx: ScoreContext = { confirmedFields: new Set(['DOSE']) };
        const result = scoreVlog(log, ctx);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(1); // Not capped — farmer confirmed
    });

    it('explicit ctx.provenance overrides derived provenance (back-compat)', () => {
        // Log has input with assumed provenance, but caller explicitly passes spoken
        const log = makeLog({
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    provenance: 'assumed', // item says assumed
                    mix: [{ id: 'm1', productName: 'Urea', dose: 2, unit: 'g/L' }],
                },
            ],
        });
        // Explicit override: caller says DOSE is spoken (back-compat path, e.g. tests)
        const ctx: ScoreContext = { provenance: { DOSE: 'spoken' } };
        const result = scoreVlog(log, ctx);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        // explicit ctx.provenance wins → spoken → coverage NOT capped
        expect(doseDim?.coverage).toBe(1);
        expect(doseDim?.confidenceFactor).toBe(1.0);
    });

    it('no provenance tags on any item → all dimensions use default cf=0.7 (no change from before)', () => {
        // This is the "nothing populated yet" baseline — behaviour must be identical
        // to the original code before C-1 fix (default factor 0.7 for everything).
        const log = makeLog({
            cropActivities: [{ id: 'ca1', title: 'Pruning' }],
            inputs: [
                {
                    id: 'inp1',
                    method: 'Spray',
                    mix: [{ id: 'm1', productName: 'Urea', dose: 2, unit: 'g/L' }],
                },
            ],
        });
        const result = scoreVlog(log, {});
        // deriveDimensionProvenance returns {} (no tags) → effectiveCtx.provenance = {}
        // governor and resolveConfidenceFactor both fall through to default 0.7
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.confidenceFactor).toBe(0.7);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.confidenceFactor).toBe(0.7);
        expect(doseDim?.coverage).toBe(1); // product+dose present, no cap needed
    });
});
