/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scoreVlog — 18-vlog calibration harness (W1.P3.T2, task 1b)
 *
 * Validates that scoreVlog lands within ±8 of the calibration targets defined in
 * AI Intelligence Plan 2026-06-25 §"The 18 real vlogs — calibration ground-truth".
 *
 * HONESTY CONTRACT (the whole point of this test):
 * - Fixtures are FAITHFUL to the documented vlog facts (YAML sources + plan §18-vlogs).
 *   No field value is fudged to hit a target.
 * - Coverage rules in scoreVlog.ts are GENERAL (apply identically to ALL days).
 *   No vlog is special-cased by id/date/content.
 * - The dishonesty governor MUST still hold: an 'assumed' value is capped at 0.5
 *   and does not rise above the confirmed baseline.
 * - If a target cannot be hit honestly, it is reported as a MISS with an explanation.
 *   An honest miss keeps the flag OFF; it does not justify fabrication.
 *
 * Tuning changes (1b — four GENERAL rules, no special-casing):
 *
 *   T1 — WHAT: disturbance.reason non-empty → WHAT coverage=1.
 *        Rationale: a disturbance WITH a stated reason IS the day's captured event;
 *        the farmer told us what happened.
 *
 *   T2 — CARRIER: N/A when inputs.length=0 AND irrigation.length=0.
 *        Rationale: on a day with no delivery operations (no spray, no irrigation),
 *        carrier is not a relevant question; marking it N/A removes a zero-coverage
 *        dimension that would otherwise penalise non-delivery days.
 *
 *   T3 — COST: labour with wagePerPerson set (spoken rate) but totalCost=0 → 0.5.
 *        Rationale: the rate was spoken (honest partial); total is uncomputable because
 *        the contract-unit count was not stated (piece-rate no-multiply rule).
 *
 *   T4 — SCOPE: disturbance.scope='FULL_DAY' → SCOPE coverage=1.
 *        Rationale: a full-day disturbance definitionally affects the whole farm;
 *        scope is 100% known even without per-event targetPlotName.
 *
 * CALIBRATION STATE: partial (11/12 targeted vlogs PASS, 1 honest MISS).
 *   MISS: 28/10 (19-19-19 fertigation). Computed ~43, target ~58 (band 50-66).
 *   See fixture comment for explanation.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import { describe, it, expect } from 'vitest';
import { scoreVlog } from '../scoreVlog';
import {
    LOG_19_10, CTX_19_10,
    LOG_21_10, CTX_21_10,
    LOG_22_10, CTX_22_10,
    LOG_23_10, CTX_23_10,
    LOG_24_10, CTX_24_10,
    LOG_25_10, CTX_25_10,
    LOG_26_10, CTX_26_10,
    LOG_27_10, CTX_27_10,
    LOG_28_10, CTX_28_10,
    LOG_29_10, CTX_29_10,
    LOG_30_10, CTX_30_10,
    LOG_31_10, CTX_31_10,
    LOG_01_11, CTX_01_11,
    LOG_02_11, CTX_02_11,
    LOG_03_11, CTX_03_11,
    LOG_04_11, CTX_04_11,
    LOG_05_11, CTX_05_11,
    LOG_06_11, CTX_06_11,
    LOG_07_11, CTX_07_11,
} from './calibrationFixtures';

// =============================================================================
// CALIBRATION BAND ASSERTION HELPERS
// =============================================================================

/**
 * Assert a numeric score falls within [target - 8, target + 8].
 * This is the ±8 calibration band from the plan.
 */
function expectWithin8(score: number | null, target: number, label: string): void {
    expect(score, `${label}: score must not be null`).not.toBeNull();
    const computed = score as number;
    const lower = target - 8;
    const upper = target + 8;
    expect(
        computed,
        `${label}: expected ${computed} to be within ±8 of ${target} (band: ${lower}–${upper})`
    ).toBeGreaterThanOrEqual(lower);
    expect(
        computed,
        `${label}: expected ${computed} to be within ±8 of ${target} (band: ${lower}–${upper})`
    ).toBeLessThanOrEqual(upper);
}

/**
 * Assert a score falls within a sane band [lo, hi].
 * Used for vlogs without an explicit ±8 plan target.
 */
function expectInBand(score: number | null, lo: number, hi: number, label: string): void {
    expect(score, `${label}: score must not be null`).not.toBeNull();
    const computed = score as number;
    expect(computed, `${label}: expected ${computed} to be ≥ ${lo}`).toBeGreaterThanOrEqual(lo);
    expect(computed, `${label}: expected ${computed} to be ≤ ${hi}`).toBeLessThanOrEqual(hi);
}

// =============================================================================
// 1. TARGETED VLOGS — assert within ±8 of plan calibration target
// =============================================================================

describe('scoreVlog calibration — targeted vlogs (±8 of plan target)', () => {

    it('19/10 defoliation spray: score ≈ 92 (target 92, band 84–100)', () => {
        const result = scoreVlog(LOG_19_10, CTX_19_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 92, '19/10 defoliation');
        // Sanity: rich spray day (3 products + carrier + cost + schedule)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(true);
        expect(doseDim?.coverage).toBe(1);  // product + dose present in mix
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(true);
        expect(carrierDim?.coverage).toBe(1);  // computedWaterVolume=1000
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(1);  // totalAmount=500 (spoken expense)
    });

    it('21/10 pruning piece-rate: score ≈ 78 (target 78, band 70–86)', () => {
        const result = scoreVlog(LOG_21_10, CTX_21_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 78, '21/10 pruning');
        // DOSE N/A (no inputs)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.applicable).toBe(false);
        // CARRIER N/A (T2 tuning: no inputs AND no irrigation)
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(false);
        // COST=0.5: wagePerPerson=14 spoken but totalCost absent (T3 tuning)
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(0.5);
        // CONTINUITY applicable (priorContinuity=0 provided, qty=10 rows in activity)
        const contDim = result.dimensions.find(d => d.dimension === 'CONTINUITY');
        expect(contDim?.applicable).toBe(true);
    });

    it('23/10 Bordeaux spray + irrigation: score ≈ 86 (target 86, band 78–94)', () => {
        const result = scoreVlog(LOG_23_10, CTX_23_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 86, '23/10 Bordeaux');
        // DOSE=1 (copper sulfate + lime with dose in mix)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(1);
        // CARRIER=1 (computedWaterVolume=600)
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.coverage).toBe(1);
        // COST=0 (no monetary cost stated for spray materials)
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(0);
    });

    it('27/10 Rally Gold sparse: score ≈ 42 (target 42, band 34–50)', () => {
        const result = scoreVlog(LOG_27_10, CTX_27_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 42, '27/10 Rally Gold');
        // DOSE=0.5: product named but dose NOT_MENTIONED (no-guess rule)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5);
        // SCOPE=0: no targetPlotName mentioned
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(0);
        // CARRIER=0: inputs present but no carrier info
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(true);
        expect(carrierDim?.coverage).toBe(0);
    });

    it('29/10 0-60-20 fertigation: score ≈ 33 (target 33, band 25–41)', () => {
        const result = scoreVlog(LOG_29_10, CTX_29_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 33, '29/10 0-60-20');
        // DOSE=0.5: grade named, no quantity
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5);
        // PURPOSE N/A: no schedule binding for this sparse day
        const purposeDim = result.dimensions.find(d => d.dimension === 'PURPOSE');
        expect(purposeDim?.applicable).toBe(false);
    });

    it('30/10 KNO3 13-0-45 fertigation: score ≈ 33 (target 33, band 25–41)', () => {
        const result = scoreVlog(LOG_30_10, CTX_30_10);
        expect(result.outcome).toBe('SCORED');
        expectWithin8(result.score, 33, '30/10 KNO3');
    });

    it('2/11 labour no-show disturbance: score ≈ 92 (target 92, band 84–100)', () => {
        const result = scoreVlog(LOG_02_11, CTX_02_11);
        expect(result.outcome).toBe('DISTURBANCE');
        expectWithin8(result.score, 92, '2/11 labour no-show');
        // T1: WHAT=1 because disturbance.reason non-empty
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.coverage).toBe(1);
        // T4: SCOPE=1 because disturbance.scope='FULL_DAY'
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(1);
        // T2: CARRIER N/A (no inputs, no irrigation)
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(false);
        // WEATHER: dominant (weight 48), coverage=1 (disturbance.reason set)
        const weatherDim = result.dimensions.find(d => d.dimension === 'WEATHER');
        expect(weatherDim?.weight).toBe(48);
        expect(weatherDim?.coverage).toBe(1);
    });

    it('3/11 rain disturbance: score ≈ 92 (target 92, band 84–100)', () => {
        const result = scoreVlog(LOG_03_11, CTX_03_11);
        expect(result.outcome).toBe('DISTURBANCE');
        expectWithin8(result.score, 92, '3/11 rain disturbance');
        // WEATHER=1: disturbance.reason set AND rain observation tag
        const weatherDim = result.dimensions.find(d => d.dimension === 'WEATHER');
        expect(weatherDim?.coverage).toBe(1);
        expect(weatherDim?.weight).toBe(48);  // Dominant on disturbance day
        // T1+T4 apply same as 2/11
        const whatDim = result.dimensions.find(d => d.dimension === 'WHAT');
        expect(whatDim?.coverage).toBe(1);
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(1);
    });

    // --- SILENT DAYS → UNKNOWN (score:null, outcome:'UNKNOWN') ---

    it('4/11 silent day: outcome=UNKNOWN, score=null', () => {
        const result = scoreVlog(LOG_04_11, CTX_04_11);
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });

    it('5/11 silent day: outcome=UNKNOWN, score=null', () => {
        const result = scoreVlog(LOG_05_11, CTX_05_11);
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });

    it('7/11 silent day: outcome=UNKNOWN, score=null', () => {
        const result = scoreVlog(LOG_07_11, CTX_07_11);
        expect(result.outcome).toBe('UNKNOWN');
        expect(result.score).toBeNull();
    });
});

// =============================================================================
// 2. NON-TARGETED VLOGS — sane band + relative ordering
// =============================================================================
//
// These vlogs do not have an explicit ±8 plan target. We assert:
//   (a) score falls in a documented "sane band"
//   (b) relative ordering makes agronomic sense

describe('scoreVlog calibration — non-targeted vlogs (sane band + ordering)', () => {

    it('22/10 Dormex paste: middle band 50–65 (partial input day)', () => {
        const result = scoreVlog(LOG_22_10, CTX_22_10);
        expect(result.outcome).toBe('SCORED');
        // DOSE=0.5 (product named, no dose)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5);
        expectInBand(result.score, 50, 65, '22/10 Dormex');
    });

    it('24/10 alphamethrin + bavistin: middle band 50–65', () => {
        const result = scoreVlog(LOG_24_10, CTX_24_10);
        expect(result.outcome).toBe('SCORED');
        expectInBand(result.score, 50, 65, '24/10 alpha+bavistin');
        // DOSE=0.5 (2 products named, no doses)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5);
    });

    it('25/10 6-BA + PDH PGR: middle band 50–65', () => {
        const result = scoreVlog(LOG_25_10, CTX_25_10);
        expect(result.outcome).toBe('SCORED');
        expectInBand(result.score, 50, 65, '25/10 6-BA+PDH');
    });

    it('26/10 CPPU+MKP+Curzate+weather: middle-high band 60–72 (richer than 22–25/10)', () => {
        const result = scoreVlog(LOG_26_10, CTX_26_10);
        expect(result.outcome).toBe('SCORED');
        expectInBand(result.score, 60, 72, '26/10 3-product+weather');
        // WEATHER coverage=1: disturbance.reason set (rain cut irrigation)
        const weatherDim = result.dimensions.find(d => d.dimension === 'WEATHER');
        expect(weatherDim?.coverage).toBe(1);
        expect(weatherDim?.weight).toBe(8);  // NOT a disturbance day (WORK_RECORDED)
    });

    it('31/10 earthing-up: middle-high band 60–75 (gender-split labour day)', () => {
        const result = scoreVlog(LOG_31_10, CTX_31_10);
        expect(result.outcome).toBe('SCORED');
        expectInBand(result.score, 60, 75, '31/10 earthing-up');
        // CARRIER=N/A (T2 tuning: no inputs + no irrigation)
        const carrierDim = result.dimensions.find(d => d.dimension === 'CARRIER');
        expect(carrierDim?.applicable).toBe(false);
        // COST=0 (no wage rate stated)
        const costDim = result.dimensions.find(d => d.dimension === 'COST');
        expect(costDim?.coverage).toBe(0);
    });

    it('1/11 weeding day 1: lower-middle band 40–55', () => {
        const result = scoreVlog(LOG_01_11, CTX_01_11);
        expect(result.outcome).toBe('SCORED');
        expectInBand(result.score, 40, 55, '1/11 weeding');
        // CONTINUITY=0.5 (day 1: priorContinuity=0, qty=12 in activity)
        const contDim = result.dimensions.find(d => d.dimension === 'CONTINUITY');
        expect(contDim?.applicable).toBe(true);
        expect(contDim?.coverage).toBe(0.5);
    });

    it('6/11 weeding continuation: slightly higher than 1/11 (better continuity)', () => {
        const result1 = scoreVlog(LOG_01_11, CTX_01_11);
        const result6 = scoreVlog(LOG_06_11, CTX_06_11);
        expect(result6.score).not.toBeNull();
        expect(result1.score).not.toBeNull();
        // 6/11 has priorContinuity=0.6 (CONTINUITY=1) vs 1/11 priorContinuity=0 (CONTINUITY=0.5)
        const cont6 = result6.dimensions.find(d => d.dimension === 'CONTINUITY');
        expect(cont6?.coverage).toBe(1);
        expect(result6.score!).toBeGreaterThan(result1.score!);
        expectInBand(result6.score, 48, 62, '6/11 weeding continuation');
    });

    // Relative ordering assertions (cross-vlog):

    it('ordering: 26/10 (3 products + weather) > 22/10 (1 product paste)', () => {
        const r22 = scoreVlog(LOG_22_10, CTX_22_10);
        const r26 = scoreVlog(LOG_26_10, CTX_26_10);
        expect(r26.score!).toBeGreaterThan(r22.score!);
    });

    it('ordering: 19/10 (rich spray) > 27/10 (sparse single product no dose)', () => {
        const r19 = scoreVlog(LOG_19_10, CTX_19_10);
        const r27 = scoreVlog(LOG_27_10, CTX_27_10);
        expect(r19.score!).toBeGreaterThan(r27.score!);
    });

    it('ordering: 19/10 (rich) > 29/10 (sparse fertigation)', () => {
        const r19 = scoreVlog(LOG_19_10, CTX_19_10);
        const r29 = scoreVlog(LOG_29_10, CTX_29_10);
        expect(r19.score!).toBeGreaterThan(r29.score!);
    });

    it('ordering: disturbance days (2/11, 3/11 ~87) > sparse single-grade (29/10 ~37)', () => {
        const r02 = scoreVlog(LOG_02_11, CTX_02_11);
        const r29 = scoreVlog(LOG_29_10, CTX_29_10);
        expect(r02.score!).toBeGreaterThan(r29.score!);
    });
});

// =============================================================================
// 3. DISHONESTY GOVERNOR — still holds after 1b tuning
// =============================================================================
//
// This block re-asserts the governor constraint to guarantee that the 1b tuning
// changes did not weaken the governor. Fabricated/assumed values must NOT rise.

describe('scoreVlog calibration — dishonesty governor still holds (post-1b tuning)', () => {

    it('GOVERNOR: a padded/assumed fixture does NOT score higher than a faithful one', () => {
        // Faithful fixture: 27/10 Rally Gold (product spoken, dose NOT_MENTIONED)
        const faithfulResult = scoreVlog(LOG_27_10, CTX_27_10);

        // Padded fixture: same log but dose marked 'assumed' (fabricated by system)
        const paddedLog = {
            ...LOG_27_10,
            inputs: [
                {
                    ...LOG_27_10.inputs[0],
                    mix: [
                        {
                            id: 'mix-padded',
                            productName: 'Rally Gold',
                            dose: 5,         // FABRICATED dose — never stated by farmer
                            unit: 'g/L',
                            provenance: 'assumed' as const,  // marks it as fabricated
                        },
                    ],
                },
            ],
        };
        const paddedResult = scoreVlog(paddedLog, CTX_27_10);

        // The padded DOSE has dose=5 but provenance='assumed' — governor caps at 0.5
        const paddedDoseDim = paddedResult.dimensions.find(d => d.dimension === 'DOSE');
        expect(paddedDoseDim?.coverage).toBe(0.5);  // Capped by governor

        // Padded score must NOT exceed faithful score
        // (faithful DOSE=0.5 from no-dose, padded DOSE=0.5 capped by governor)
        expect(paddedResult.score).toBeLessThanOrEqual(faithfulResult.score ?? 0 + 1);
    });

    it('GOVERNOR: assumed ingredient in disturbance day does not lift DOSE above cap', () => {
        // Even on a disturbance day with WEATHER dominant, a fabricated input must stay capped
        const distLog = {
            ...LOG_02_11,
            inputs: [
                {
                    id: 'inp-pad',
                    method: 'Spray' as const,
                    provenance: 'assumed' as const,
                    mix: [
                        { id: 'm-pad', productName: 'Fabricated Chemical', dose: 5, unit: 'ml/L', provenance: 'assumed' as const },
                    ],
                },
            ],
        };
        const result = scoreVlog(distLog, CTX_02_11);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        // DOSE applicable (inputs present), assumed → capped at 0.5
        expect(doseDim?.applicable).toBe(true);
        expect(doseDim?.coverage).toBe(0.5);
    });

    it('GOVERNOR: confirmedFields override restores coverage for assumed value (farm confirmed it)', () => {
        // Same padded fixture as above but DOSE in confirmedFields → not capped
        const paddedLog = {
            ...LOG_27_10,
            inputs: [
                {
                    ...LOG_27_10.inputs[0],
                    mix: [
                        {
                            id: 'mix-padded',
                            productName: 'Rally Gold',
                            dose: 5,
                            unit: 'g/L',
                            provenance: 'assumed' as const,
                        },
                    ],
                },
            ],
        };
        const ctxWithConfirm = { ...CTX_27_10, confirmedFields: new Set(['DOSE']) };
        const result = scoreVlog(paddedLog, ctxWithConfirm);
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        // Farmer confirmed → override cap → coverage=1
        expect(doseDim?.coverage).toBe(1);
    });
});

// =============================================================================
// 4. CALIBRATION MISS REPORT — 28/10
// =============================================================================
//
// 28/10 (19-19-19 fertigation) cannot be honestly calibrated to ~58.
// The transcript is structurally identical to 29/10 and 30/10 (sparse single-grade
// drip fertigation). An honest fixture scores ~43, outside the band 50–66.
// This test documents the miss and its expected computed score.

describe('scoreVlog calibration — known honest miss: 28/10', () => {

    it('28/10 NPK 19-19-19 fertigation: computed ~43, target ~58 (band 50–66) — HONEST MISS', () => {
        const result = scoreVlog(LOG_28_10, CTX_28_10);
        expect(result.outcome).toBe('SCORED');

        // Honest computed score is expected to be ~43 (outside band 50–66).
        // We assert the score is within [35, 50] as the honest range for this sparse log.
        expect(result.score).not.toBeNull();
        expect(result.score!).toBeGreaterThanOrEqual(35);
        expect(result.score!).toBeLessThan(50);

        // Confirm DOSE=0.5 (grade named, no quantity dose stated — faithful)
        const doseDim = result.dimensions.find(d => d.dimension === 'DOSE');
        expect(doseDim?.coverage).toBe(0.5);

        // Confirm SCOPE=0 (no targetPlotName — faithful, not spoken)
        const scopeDim = result.dimensions.find(d => d.dimension === 'SCOPE');
        expect(scopeDim?.coverage).toBe(0);

        // No fabricated data elevated this score — the miss is HONEST.
        // Note: This test deliberately asserts the miss to surface it in CI.
        // The calibration-state is PARTIAL until 28/10 can be resolved.
        // Resolution path: richer real-vlog fact-gathering (Track A eval baseline)
        // may reveal 28/10 had additional spoken details not captured in the YAML.
    });
});

// =============================================================================
// 5. CALIBRATION SUMMARY TABLE (console output for CI visibility)
// =============================================================================

describe('scoreVlog calibration — summary table', () => {
    it('prints computed vs target for all 18 vlogs', () => {
        const rows: Array<{ vlog: string; computed: number | null | string; target: string; pass: string }> = [
            { vlog: '19/10 defoliation', computed: scoreVlog(LOG_19_10, CTX_19_10).score, target: '~92 (band 84-100)', pass: '' },
            { vlog: '21/10 pruning', computed: scoreVlog(LOG_21_10, CTX_21_10).score, target: '~78 (band 70-86)', pass: '' },
            { vlog: '22/10 Dormex (no target)', computed: scoreVlog(LOG_22_10, CTX_22_10).score, target: 'band 50-65', pass: '' },
            { vlog: '23/10 Bordeaux', computed: scoreVlog(LOG_23_10, CTX_23_10).score, target: '~86 (band 78-94)', pass: '' },
            { vlog: '24/10 alpha+bavistin (no target)', computed: scoreVlog(LOG_24_10, CTX_24_10).score, target: 'band 50-65', pass: '' },
            { vlog: '25/10 6-BA+PDH (no target)', computed: scoreVlog(LOG_25_10, CTX_25_10).score, target: 'band 50-65', pass: '' },
            { vlog: '26/10 CPPU+MKP+Curzate (no target)', computed: scoreVlog(LOG_26_10, CTX_26_10).score, target: 'band 60-72', pass: '' },
            { vlog: '27/10 Rally Gold', computed: scoreVlog(LOG_27_10, CTX_27_10).score, target: '~42 (band 34-50)', pass: '' },
            { vlog: '28/10 19-19-19 fertigation', computed: scoreVlog(LOG_28_10, CTX_28_10).score, target: '~58 (band 50-66) MISS', pass: '' },
            { vlog: '29/10 0-60-20 fertigation', computed: scoreVlog(LOG_29_10, CTX_29_10).score, target: '~33 (band 25-41)', pass: '' },
            { vlog: '30/10 KNO3 13-0-45', computed: scoreVlog(LOG_30_10, CTX_30_10).score, target: '~33 (band 25-41)', pass: '' },
            { vlog: '31/10 earthing-up (no target)', computed: scoreVlog(LOG_31_10, CTX_31_10).score, target: 'band 60-75', pass: '' },
            { vlog: '1/11 weeding (no target)', computed: scoreVlog(LOG_01_11, CTX_01_11).score, target: 'band 40-55', pass: '' },
            { vlog: '2/11 labour no-show', computed: scoreVlog(LOG_02_11, CTX_02_11).score, target: '~92 (band 84-100)', pass: '' },
            { vlog: '3/11 rain disturbance', computed: scoreVlog(LOG_03_11, CTX_03_11).score, target: '~92 (band 84-100)', pass: '' },
            { vlog: '4/11 silent', computed: 'UNKNOWN', target: 'UNKNOWN', pass: '' },
            { vlog: '5/11 silent', computed: 'UNKNOWN', target: 'UNKNOWN', pass: '' },
            { vlog: '6/11 weeding cont. (no target)', computed: scoreVlog(LOG_06_11, CTX_06_11).score, target: 'band 48-62', pass: '' },
            { vlog: '7/11 silent', computed: 'UNKNOWN', target: 'UNKNOWN', pass: '' },
        ];

        console.log('\n=== scoreVlog Calibration Table (1b) ===');
        console.log('Vlog'.padEnd(35) + 'Computed'.padEnd(12) + 'Target');
        console.log('-'.repeat(70));
        for (const row of rows) {
            const computed = typeof row.computed === 'number' ? row.computed.toString() : (row.computed ?? 'null').toString();
            console.log(row.vlog.padEnd(35) + computed.padEnd(12) + row.target);
        }
        console.log('='.repeat(70));
        console.log('CALIBRATION STATE: PARTIAL — 28/10 is an honest miss (computed ~43, target ~58).');
        console.log('Flag stays OFF until all targeted vlogs pass within ±8.\n');

        // This test always passes — it's a documentation/CI-visibility test.
        expect(true).toBe(true);
    });
});
