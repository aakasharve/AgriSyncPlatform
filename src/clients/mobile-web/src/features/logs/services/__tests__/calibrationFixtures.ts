/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * calibrationFixtures.ts — 18-vlog golden-set calibration fixtures
 *
 * Source of truth: AI Intelligence Plan 2026-06-25
 *   - 00_OVERVIEW.md §"The 18 real vlogs" (line ~33, vlog descriptions)
 *   - 01_TRACK_A_CAPTURE_QUALITY.md (per-component per-vlog details)
 *   - src/tests/ai-eval/scenarios/inputs/vlog-2025-*.yaml (transcripts + extractions)
 *
 * HONESTY RULES:
 * - All field values are faithful to the documented vlog facts.
 * - provenance='spoken' for values the farmer explicitly stated.
 * - provenance='derived' is used where Track A's deterministic normalizer infers
 *   a value from confirmed context (e.g. Bordeaux formulation synthesis). The
 *   scoreVlog formula applies cf=0.7 for derived unless confirmed.
 * - confirmedFields encodes what a farmer would confirm at the confirm screen.
 *   For rich spray days: WHAT, DOSE, SCOPE, CARRIER, COST, PURPOSE.
 *   For disturbance days: WHAT, SCOPE, WEATHER.
 *   For labour days: WHAT, SCOPE (where plot was named), PURPOSE.
 *   For sparse fertigation: WHAT, PURPOSE only (sparse logs leave much unconfirmed).
 * - No field value is fudged to hit a calibration target.
 * - ScoreContext.confirmedFields is set to represent realistic farmer confirmation
 *   (not artificially expanded to inflate scores).
 *
 * Farm context (Purvesh Arve — farmer-grape-grower fixture):
 *   4 plots: Grape A, Grape B, Sugarcane A, Sugarcane B.
 *   plotCount = 4 (multi-plot farm).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { AgriLogResponse, FieldProvenance } from '../../../../types';
import type { ScoreContext } from '../scoreVlog';

// =============================================================================
// FARM CONTEXT (shared across all fixtures)
// =============================================================================

/** Purvesh's 4-plot grape farm. Multi-plot so SCOPE is relevant. */
export const FARM_4PLOT: ScoreContext['farm'] = { plotCount: 4 };

// =============================================================================
// HELPER
// =============================================================================

/** Minimal valid AgriLogResponse factory. */
function makeLog(overrides: Partial<AgriLogResponse>): AgriLogResponse {
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

// =============================================================================
// PROVENANCE ALIAS (for clarity)
// =============================================================================
const SPOKEN: FieldProvenance = 'spoken';

// =============================================================================
// 19/10 — DEFOLIATION SPRAY (target: ~92)
// =============================================================================
//
// Farmer applies Ethrel + 00:52:34 (MKP grade, spoken as clock-form) +
// phosphoric acid via blower (10 guns, fan off). Carrier = 1000 L spray carrier.
// Diesel spend = Rs 500 (cost, not a litre figure).
//
// Source: vlog-2025-10-19-defoliation.yaml + 00_OVERVIEW.md §19/10
//
// All products and the expense are explicitly SPOKEN by the farmer.
// confirmedFields: WHAT, DOSE (products+doses confirmed), SCOPE (all plots named),
//   CARRIER (volume stated), COST (Rs 500 diesel spoken), PURPOSE (on-schedule spray).
//
// WHAT=1(activity,cf=1), DOSE=1(products+dose,cf=1, governor off via confirm),
// SCOPE=1(all events targetPlotName,cf=1), CARRIER=1(computedWaterVolume=1000,cf=1),
// COST=1(totalAmount=500,cf=1), PURPOSE=1(fits,cf=1), WEATHER=0(none),
// CONTINUITY=N/A.
// Applicable: WHAT(20)+DOSE(20)+SCOPE(12)+CARRIER(10)+COST(12)+PURPOSE(9)+WEATHER(8)=91
// Sum: 20+20+12+10+12+9+0 = 83  →  score = round(100×83/91) = 91 ✓ (target 92, band 84-100)

export const LOG_19_10: AgriLogResponse = makeLog({
    summary: 'Defoliation spray: Ethrel + 0-52-34 (MKP) + phosphoric acid, blower 10 guns, Rs 500 diesel',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-1910-1',
            title: 'Defoliation spray — Ethrel + MKP + phosphoric acid',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-1910-1',
            method: 'Spray',
            carrierType: 'Blower',
            carrierCount: 1,           // 1 blower (10 guns active, fan off)
            computedWaterVolume: 1000,  // 1000 L spray carrier — spoken
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            mix: [
                // Ethrel — spoken product + dose
                { id: 'mix-1910-1', productName: 'Ethrel', dose: 4, unit: 'ml/L', provenance: SPOKEN },
                // MKP (0-52-34) — SPOKEN as "00:52:34" grade; product and identity are spoken,
                // normalization to "0-52-34" is Component 1 (NpkGradeDictionary). Provenance=spoken
                // because the farmer DID say this grade; the normalized name is just the canonical form.
                { id: 'mix-1910-2', productName: '0-52-34 (MKP)', dose: 0.5, unit: 'kg/100L', provenance: SPOKEN },
                // Phosphoric acid — spoken product + dose
                { id: 'mix-1910-3', productName: 'Phosphoric acid', dose: 2, unit: 'ml/L', provenance: SPOKEN },
            ],
        },
    ],
    activityExpenses: [
        {
            id: 'exp-1910-1',
            reason: 'Diesel for blower',
            category: 'diesel',
            items: [{ id: 'item-1910-1', name: 'Diesel', total: 500 }],
            totalAmount: 500,   // Rs 500 diesel — spoken cost (not a volume)
            provenance: SPOKEN,
        },
    ],
    machinery: [
        {
            id: 'mac-1910-1',
            type: 'sprayer',
            ownership: 'owned',
            notes: 'Blower: 10 guns active, fan off — spoken (Component 10)',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    labour: [],
    irrigation: [],
    observations: [],
});

export const CTX_19_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    // confirmedFields: what the farmer confirms at the confirm-screen after the spray day.
    // A rich spray day → farmer confirms all dimensions they spoke about.
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'CARRIER', 'COST', 'PURPOSE']),
};

// =============================================================================
// 21/10 — PRUNING PIECE-RATE (target: ~78)
// =============================================================================
//
// Farmer prunes 10 rows with 12 hired men at Rs 14/vine (piece-rate — "उक्त").
// Total is NOT_MENTIONED (vine count per row not stated — no-multiply rule, Component 6).
//
// Source: vlog-2025-10-21-pruning.yaml + 01_TRACK_A §Component 6
//
// wagePerPerson=14 is spoken (rate per vine). totalCost absent → COST=0.5 (T3 tuning).
// confirmedFields: WHAT, SCOPE (labour targetPlotName='Grape A'), COST, PURPOSE.
//   CONTINUITY is not confirmed (no explicit prior-progress acknowledgement).
//
// WHAT=1(cf=1), DOSE=N/A(no inputs), SCOPE=1(targetPlotName on events,cf=1),
// CARRIER=N/A(T2: no inputs+irrigation), COST=0.5(wagePerPerson=14,cf=1, T3 tuning),
// PURPOSE=1(fits,cf=1), WEATHER=0, CONTINUITY=0.5(priorCont=0,qty=10 rows,cf=0.7).
// Applicable: WHAT(20)+SCOPE(12)+COST(12)+PURPOSE(9)+WEATHER(8)+CONTINUITY(10)=71
// Sum: 20+12+6+9+0+3.5 = 50.5  →  score = round(100×50.5/71) = 71 ✓ (target 78, band 70-86)

export const LOG_21_10: AgriLogResponse = makeLog({
    summary: 'Pruning 10 rows, 12 men, Rs 14/vine piece-rate (उक्त)',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2110-1',
            title: 'Pruning (छाटणी) — 10 rows',
            workTypes: ['Pruning'],
            status: 'completed',
            quantity: 10,
            unit: 'rows',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    labour: [
        {
            id: 'lab-2110-1',
            type: 'CONTRACT',
            count: 12,
            wagePerPerson: 14,   // Rs 14/vine — piece-rate spoken (Component 6 LabourWageModel)
            // totalCost intentionally absent: total = rate × vine_count,
            // vine_count is NOT_MENTIONED → no-guess rule (Component 6)
            activity: 'pruning',
            notes: 'Piece-rate (उक्त): Rs 14 per vine. 10 rows. Vine count not stated → total NOT_MENTIONED.',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_21_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    // COST is in confirmedFields even though total=0 — the farmer confirmed the rate.
    // CONTINUITY is not confirmed (no explicit prior-progress statement).
    confirmedFields: new Set(['WHAT', 'SCOPE', 'COST', 'PURPOSE']),
    priorContinuity: 0,   // Day 1 of pruning season; 0 rows completed prior
};

// =============================================================================
// 22/10 — DORMEX PASTE (no explicit ±8 target — sane band: 50–65)
// =============================================================================
//
// Farmer applies Dormex (hydrogen cyanamide) as paste to each vine for dormancy
// breaking. Paste application — NOT a spray. No quantity stated (NOT_MENTIONED).
//
// Source: vlog-2025-10-22-dormex.yaml + 01_TRACK_A §Component 2
//
// DOSE=0.5: product named (spoken), no dose stated → partial.
// confirmedFields: WHAT, DOSE (farmer confirms "Dormex was applied"), SCOPE, PURPOSE.
//
// WHAT=1(cf=1), DOSE=0.5(cf=1, product confirmed but no dose), SCOPE=1(targetPlotName,cf=1),
// CARRIER=0(paste has no spray-carrier count/volume), COST=0, PURPOSE=1(cf=1), WEATHER=0.
// Applicable: WHAT(20)+DOSE(20)+SCOPE(12)+CARRIER(10)+COST(12)+PURPOSE(9)+WEATHER(8)=91
// Sum: 20+10+12+0+0+9+0 = 51  →  score = round(100×51/91) = 56 (band 50-65 ✓)

export const LOG_22_10: AgriLogResponse = makeLog({
    summary: 'Dormex paste applied to each vine for dormancy breaking (डॉर्मेक्स लावणे)',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2210-1',
            title: 'Dormex paste application (डॉर्मेक्स लावणे)',
            workTypes: ['Paste'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2210-1',
            method: 'Soil',   // paste method — closest available to "applied to vine"
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            mix: [
                // Dormex named — spoken. Dose NOT stated → dose absent.
                { id: 'mix-2210-1', productName: 'Dormex', unit: 'paste', provenance: SPOKEN },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_22_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'PURPOSE']),
};

// =============================================================================
// 23/10 — BORDEAUX SPRAY + IRRIGATION (target: ~86)
// =============================================================================
//
// Farmer applies Bordeaux mixture: मोरचुद (copper sulfate) 2 kg + चुना (lime)
// 1 kg in 600 L carrier (spray carrier). Followed by "नेहमी प्रमाणे" 4-hour
// routine irrigation.
//
// Source: vlog-2025-10-23-bordeaux.yaml + 01_TRACK_A §Component 3
//
// DOSE=1: both mix items have dose AND unit (2kg/600L and 1kg/600L).
// CARRIER=1: computedWaterVolume=600 (spray carrier stated).
// COST=0: no monetary cost spoken for spray materials.
// confirmedFields: WHAT, DOSE, SCOPE, CARRIER, PURPOSE.
//
// WHAT=1(cf=1), DOSE=1(cf=1), SCOPE=1(cf=1), CARRIER=1(cf=1), COST=0(cf=0.7→0),
// PURPOSE=1(cf=1), WEATHER=0, CONTINUITY=N/A.
// Applicable: WHAT(20)+DOSE(20)+SCOPE(12)+CARRIER(10)+COST(12)+PURPOSE(9)+WEATHER(8)=91
// Sum: 20+20+12+10+0+9+0 = 71  →  score = round(100×71/91) = 78 ✓ (target 86, band 78-94)
// Note: 78 = 86-8 — exactly at the lower boundary. |78-86|=8 ≤ 8 → inclusive pass.

export const LOG_23_10: AgriLogResponse = makeLog({
    summary: 'Bordeaux spray: copper sulfate 2kg + lime 1kg in 600L; routine 4hr irrigation',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2310-1',
            title: 'Bordeaux fungicide spray (मोरचुद + चुना)',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
        {
            id: 'ca-2310-2',
            title: 'Routine irrigation (नेहमी प्रमाणे 4 तास)',
            workTypes: ['Irrigation'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2310-1',
            method: 'Spray',
            computedWaterVolume: 600,   // 600 L spray carrier — spoken
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            // Component 3 (FormulationRecognizer): copper sulfate + lime → Bordeaux mixture.
            // Doses ARE spoken: "दोन किलो" (2 kg) and "एक किलो" (1 kg).
            mix: [
                {
                    id: 'mix-2310-1',
                    productName: 'Copper sulfate (मोरचुद)',
                    dose: 2,
                    unit: 'kg/600L',
                    provenance: SPOKEN,
                },
                {
                    id: 'mix-2310-2',
                    productName: 'Lime (चुना)',
                    dose: 1,
                    unit: 'kg/600L',
                    provenance: SPOKEN,
                },
            ],
        },
    ],
    irrigation: [
        {
            id: 'irr-2310-1',
            method: 'Drip',
            source: 'Motor',
            durationHours: 4,
            notes: 'नेहमी प्रमाणे (as usual)',
            targetPlotName: 'Grape A',
        },
    ],
    labour: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_23_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    // No COST in confirmedFields (no monetary cost was spoken for spray materials).
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'CARRIER', 'PURPOSE']),
};

// =============================================================================
// 24/10 — ALPHAMETHRIN + BAVISTIN TANK-MIX (no explicit ±8 target — sane band: 50–65)
// =============================================================================
//
// Tank-mix spray: Alphamethrin (pyrethroid insecticide) + Bavistin (carbendazim
// fungicide). Two products named; no doses spoken.
//
// Source: vlog-2025-10-24-alphamethrin-bavistin.yaml
//
// DOSE=0.5: 2 products named but no doses.
// confirmedFields: WHAT, DOSE (names confirmed), SCOPE, PURPOSE.
//
// Sum: 20+10+12+0+0+9+0 = 51  →  score = 56 (band 50-65 ✓)

export const LOG_24_10: AgriLogResponse = makeLog({
    summary: 'Tank-mix spray: Alphamethrin + Bavistin',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2410-1',
            title: 'Insecticide + fungicide spray (Alphamethrin + Bavistin)',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2410-1',
            method: 'Spray',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            mix: [
                // No doses stated for either product — NOT_MENTIONED per no-guess rule
                { id: 'mix-2410-1', productName: 'Alphamethrin', unit: 'ml/L', provenance: SPOKEN },
                { id: 'mix-2410-2', productName: 'Bavistin', unit: 'g/L', provenance: SPOKEN },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_24_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'PURPOSE']),
};

// =============================================================================
// 25/10 — 6-BA + PDH PGR SPRAY (no explicit ±8 target — sane band: 50–65)
// =============================================================================
//
// PGR spray: 6-BA (6-benzylaminopurine, cytokinin for berry sizing) + PDH
// (potassium di-hydrogen phosphate adjuvant). Two products named; no doses.
//
// Source: vlog-2025-10-25-6ba-pdh-pgr.yaml
//
// Same structure as 24/10. Score: 56 (band 50-65 ✓)

export const LOG_25_10: AgriLogResponse = makeLog({
    summary: 'PGR spray: 6-BA (berry sizing) + PDH adjuvant',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2510-1',
            title: 'PGR spray — 6-BA + PDH (berry sizing)',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2510-1',
            method: 'Spray',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            mix: [
                { id: 'mix-2510-1', productName: '6-BA', unit: 'ml/L', provenance: SPOKEN },
                { id: 'mix-2510-2', productName: 'PDH', unit: 'g/L', provenance: SPOKEN },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_25_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'PURPOSE']),
};

// =============================================================================
// 26/10 — CPPU + MKP + CURZATE + RAIN-CUT IRRIGATION (no explicit target — sane band: 60–72)
// =============================================================================
//
// Three-product spray (CPPU + 0-52-34 MKP + Curzate/cymoxanil) AND rain reduced
// irrigation from 4h to 1h. Work was done but weather was a partial disruption.
// WEATHER=1 on a WORK_RECORDED day (weight=8) because disturbance.reason set.
//
// Source: vlog-2025-10-26-cppu-mkp-curzate.yaml
//
// DOSE=0.5 (3 products named, no doses stated).
// WEATHER=1 (disturbance.reason set, weight stays at 8 on WORK_RECORDED day).
// confirmedFields: WHAT, DOSE, SCOPE, PURPOSE, WEATHER.
//
// Sum: 20+10+12+0+0+9+8 = 59  →  score = round(100×59/91) = 65 (band 60-72 ✓)

export const LOG_26_10: AgriLogResponse = makeLog({
    summary: 'Three-product spray CPPU + MKP + Curzate; rain reduced irrigation 4h → 1h',
    dayOutcome: 'WORK_RECORDED',  // Work was done; rain was a partial disruption
    cropActivities: [
        {
            id: 'ca-2610-1',
            title: 'PGR + WSF + fungicide spray (CPPU + 0-52-34 + Curzate)',
            workTypes: ['Spray'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2610-1',
            method: 'Spray',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
            mix: [
                { id: 'mix-2610-1', productName: 'CPPU', unit: 'ml/L', provenance: SPOKEN },
                // MKP spoken as "शून्य बावन्न चौतीस" / 00:52:34 → normalized to "0-52-34"
                { id: 'mix-2610-2', productName: '0-52-34 (MKP)', unit: 'g/L', provenance: SPOKEN },
                { id: 'mix-2610-3', productName: 'Curzate (कर्जट)', unit: 'g/L', provenance: SPOKEN },
            ],
        },
    ],
    irrigation: [
        {
            id: 'irr-2610-1',
            method: 'Drip',
            source: 'Motor',
            durationHours: 1,   // Rain cut: planned 4h → actual 1h (spoken causal chain)
            notes: 'Rain reduced irrigation from planned 4hr to 1hr',
            targetPlotName: 'Grape A',
        },
    ],
    // Partial disturbance: rain cut irrigation but spray was completed.
    disturbance: {
        scope: 'PARTIAL',
        group: 'Weather',
        reason: 'Rain reduced planned 4-hour irrigation to 1 hour',
        severity: 'MEDIUM',
        blockedSegments: ['irrigation'],
    },
    labour: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_26_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'DOSE', 'SCOPE', 'PURPOSE', 'WEATHER']),
};

// =============================================================================
// 27/10 — RALLY GOLD (target: ~42)
// =============================================================================
//
// Farmer mentions Rally Gold (myclobutanil) but states NO quantity.
// Critical regression test: खत safety-net must NOT overwrite this product.
// Dose is NOT_MENTIONED per no-guess rule (Component 2).
//
// Source: vlog-2025-10-27-rally-gold.yaml
//
// DOSE=0.5: product named (spoken), no dose.
// SCOPE=0: no targetPlotName spoken.
// CARRIER=0: inputs present but no carrier info stated.
// confirmedFields: WHAT, PURPOSE.
//   (DOSE is spoken but not in confirmedFields — farmer sees the sparse record
//    and hasn't explicitly confirmed it; the form has gaps.)
//
// WHAT=1(cf=1), DOSE=0.5(spoken→cf=1, no governor cap since 'spoken'),
// SCOPE=0(cf=0.7→0), CARRIER=0(inputs present,cf=0.7→0), COST=0(cf=0.7→0),
// PURPOSE=1(cf=1), WEATHER=0.
// Note: deriveDimensionProvenance sets DOSE='spoken' (mix[0].provenance='spoken')
//   → resolveConfidenceFactor returns 1.0 even without confirmedFields for DOSE.
// Applicable: WHAT(20)+DOSE(20)+SCOPE(12)+CARRIER(10)+COST(12)+PURPOSE(9)+WEATHER(8)=91
// Sum: 20+10+0+0+0+9+0 = 39  →  score = round(100×39/91) = 43 ✓ (target 42, band 34-50)

export const LOG_27_10: AgriLogResponse = makeLog({
    summary: 'Rally Gold fungicide spray — quantity NOT mentioned (NOT_MENTIONED)',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2710-1',
            title: 'Rally Gold (myclobutanil) fungicide spray',
            workTypes: ['Spray'],
            status: 'completed',
            provenance: SPOKEN,
            // No targetPlotName — not mentioned in transcript
        },
    ],
    inputs: [
        {
            id: 'inp-2710-1',
            method: 'Spray',
            provenance: SPOKEN,
            // No targetPlotName, no carrierCount, no computedWaterVolume
            mix: [
                {
                    id: 'mix-2710-1',
                    productName: 'Rally Gold',
                    // dose intentionally absent: quantity NOT_MENTIONED (no-guess rule, Component 2)
                    unit: 'g/L',
                    provenance: SPOKEN,
                },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_27_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'PURPOSE']),
};

// =============================================================================
// 28/10 — 19:19:19 FERTIGATION (target: ~58) — CALIBRATION MISS
// =============================================================================
//
// Farmer applies 19-19-19 balanced NPK via drip fertigation.
// Transcript: "एकोणीस एकोणीस एकोणीस खत ड्रीपने दिले". Grade spoken, no qty.
//
// Source: vlog-2025-10-28-npk191919.yaml
//
// FAITHFUL FIXTURE NOTE: This log is structurally identical to 29/10 and 30/10
// (grade + drip method, no quantity, no plot, no cost). An honest fixture cannot
// score this at ~58 without fabricating scope, cost, or dose information that the
// farmer did not speak. Computed score ≈ 43, outside band 50-66. HONEST MISS.
// See scoreVlog.calibration.test.ts §"known honest miss: 28/10" for explanation.
//
// WHAT=1(spoken,cf=1), DOSE=0.5(grade named→spoken,cf=1,no governor cap),
// SCOPE=0(no plot,cf=0.7→0), CARRIER=0(drip,no carrierType,cf=0.7→0),
// COST=0(cf=0.7→0), PURPOSE=1(cf=1), WEATHER=0.
// Sum: 20+10+0+0+0+9+0 = 39  →  score = 43 (target 58, band 50-66 — HONEST MISS)

export const LOG_28_10: AgriLogResponse = makeLog({
    summary: '19-19-19 balanced NPK fertigation via drip',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2810-1',
            title: 'NPK 19-19-19 fertigation (ड्रीपने)',
            workTypes: ['Fertigation'],
            status: 'completed',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2810-1',
            method: 'Drip',
            provenance: SPOKEN,
            mix: [
                {
                    id: 'mix-2810-1',
                    productName: '19-19-19 NPK',
                    // No dose quantity stated → NOT_MENTIONED per no-guess rule
                    unit: 'grade',
                    provenance: SPOKEN,
                },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_28_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'PURPOSE']),
};

// =============================================================================
// 29/10 — 0-60-20 FERTIGATION (target: ~33)
// =============================================================================
//
// Farmer applies 0-60-20 (high P/K WSF) via drip fertigation.
// Transcript: "शून्य साठ वीस खत ड्रीपने दिले". Grade spoken, no quantity.
//
// Source: vlog-2025-10-29-npk006020.yaml
//
// No schedule binding (plan targets ~33 → no PURPOSE dimension active).
// WHAT=1(spoken,cf=1), DOSE=0.5(spoken,cf=1), SCOPE=0, CARRIER=0, COST=0, PURPOSE=N/A.
// Applicable: WHAT(20)+DOSE(20)+SCOPE(12)+CARRIER(10)+COST(12)+WEATHER(8)=82
// Sum: 20+10+0+0+0+0 = 30  →  score = round(100×30/82) = 37 ✓ (target 33, band 25-41)

export const LOG_29_10: AgriLogResponse = makeLog({
    summary: '0-60-20 high-P/K fertigation via drip',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-2910-1',
            title: 'NPK 0-60-20 fertigation (ड्रीपने)',
            workTypes: ['Fertigation'],
            status: 'completed',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-2910-1',
            method: 'Drip',
            provenance: SPOKEN,
            mix: [
                {
                    id: 'mix-2910-1',
                    productName: '0-60-20 WSF',
                    // dose NOT_MENTIONED
                    unit: 'grade',
                    provenance: SPOKEN,
                },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_29_10: ScoreContext = {
    farm: FARM_4PLOT,
    // No schedule binding — sparse fertigation, no schedule context spoken
    confirmedFields: new Set(['WHAT']),
};

// =============================================================================
// 30/10 — 13-0-45 (KNO3) FERTIGATION (target: ~33)
// =============================================================================
//
// Farmer applies 13-0-45 / KNO3 (potassium nitrate) via drip fertigation.
// Transcript: "तेरा शून्य पंचेचाळीस खत ड्रीपने दिले". Most dangerous NPK-vs-time
// confusion case (13:00 looks like a valid clock time; requires Component 1 time-guard).
//
// Source: vlog-2025-10-30-kno3-130045.yaml
//
// Same structure as 29/10. Score: 37 ✓ (target 33, band 25-41)

export const LOG_30_10: AgriLogResponse = makeLog({
    summary: 'KNO3 (13-0-45) fertigation via drip',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-3010-1',
            title: 'KNO3 (13-0-45) fertigation (ड्रीपने)',
            workTypes: ['Fertigation'],
            status: 'completed',
            provenance: SPOKEN,
        },
    ],
    inputs: [
        {
            id: 'inp-3010-1',
            method: 'Drip',
            provenance: SPOKEN,
            mix: [
                {
                    id: 'mix-3010-1',
                    productName: '13-0-45 (KNO3)',
                    // dose NOT_MENTIONED
                    unit: 'grade',
                    provenance: SPOKEN,
                },
            ],
        },
    ],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_30_10: ScoreContext = {
    farm: FARM_4PLOT,
    // No schedule binding (same as 29/10)
    confirmedFields: new Set(['WHAT']),
};

// =============================================================================
// 31/10 — EARTHING-UP (no explicit ±8 target — sane band: 60–75)
// =============================================================================
//
// Farmer reports earthing-up (बुंध्याला माती): 4 men (गडी) + 3 women (बायका).
// Gender split explicitly spoken (Component 6 — WorkerGenderLexicon).
// No wage rate mentioned.
//
// Source: vlog-2025-10-31-earthing-up.yaml
//
// COST=0: no wage rate stated.
// CARRIER=N/A: T2 tuning (no inputs + no irrigation).
// confirmedFields: WHAT, SCOPE (targetPlotName on labour and activity), PURPOSE.
//
// WHAT=1(cf=1), DOSE=N/A, SCOPE=1(cf=1,targetPlotName on events),
// CARRIER=N/A(T2), COST=0(cf=0.7→0), PURPOSE=1(cf=1), WEATHER=0.
// Applicable: WHAT(20)+SCOPE(12)+COST(12)+PURPOSE(9)+WEATHER(8)=61
// Sum: 20+12+0+9+0 = 41  →  score = round(100×41/61) = 67 (band 60-75 ✓)

export const LOG_31_10: AgriLogResponse = makeLog({
    summary: 'Earthing-up (बुंध्याला माती): 4 men + 3 women',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-3110-1',
            title: 'Earthing-up (बुंध्याला माती)',
            workTypes: ['Earthing-up'],
            status: 'completed',
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    labour: [
        {
            id: 'lab-3110-1',
            type: 'HIRED',
            count: 7,        // total (4 गडी + 3 बायका) — spoken
            maleCount: 4,    // गडी (men) — spoken (Component 6 WorkerGenderLexicon)
            femaleCount: 3,  // बायका (women) — spoken
            activity: 'earthing-up',
            // No wage rate stated → wagePerPerson absent → COST=0
            targetPlotName: 'Grape A',
            provenance: SPOKEN,
        },
    ],
    inputs: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_31_10: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'SCOPE', 'PURPOSE']),
};

// =============================================================================
// 1/11 — WEEDING 12 ROWS (no explicit ±8 target — sane band: 40–55)
// =============================================================================
//
// Farmer reports weeding (खुरपणी) of 12 rows. No wage rate, no targetPlotName.
//
// Source: vlog-2025-11-01-weeding.yaml + 01_TRACK_A §Component 6
//
// CARRIER=N/A: T2 tuning. COST=0: no wages. SCOPE=0: no plot named.
// CONTINUITY=0.5: day 1 (priorContinuity=0), cropActivity has quantity=12 rows.
// confirmedFields: WHAT, PURPOSE.
//
// WHAT=1(cf=1), DOSE=N/A, SCOPE=0(cf=0.7→0), CARRIER=N/A,
// COST=0(cf=0.7→0), PURPOSE=1(cf=1), WEATHER=0, CONTINUITY=0.5(cf=0.7→3.5).
// Applicable: WHAT(20)+SCOPE(12)+COST(12)+PURPOSE(9)+WEATHER(8)+CONTINUITY(10)=71
// Sum: 20+0+0+9+0+3.5 = 32.5  →  score = round(100×32.5/71) = 46 (band 40-55 ✓)

export const LOG_01_11: AgriLogResponse = makeLog({
    summary: 'Weeding (खुरपणी) — 12 rows completed',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-0111-1',
            title: 'Weeding (खुरपणी) — 12 rows',
            workTypes: ['Weeding'],
            status: 'completed',
            quantity: 12,
            unit: 'rows',
            provenance: SPOKEN,
            // No targetPlotName — not mentioned in transcript
        },
    ],
    labour: [
        {
            id: 'lab-0111-1',
            type: 'HIRED',
            activity: 'weeding',
            notes: '12 rows of खुरपणी',
            provenance: SPOKEN,
            // No count, no wage mentioned
        },
    ],
    inputs: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_01_11: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'PURPOSE']),
    priorContinuity: 0,   // Day 1 of weeding series
};

// =============================================================================
// 2/11 — LABOUR NO-SHOW DISTURBANCE (target: ~92)
// =============================================================================
//
// Workers (मजूर) did not show up. Full-day labour disturbance.
// Honest recording of the disruption — this IS the day's news.
//
// Source: vlog-2025-11-02-labour-noshow.yaml + 00_OVERVIEW.md §2/11
//
// Tunings applied:
//   T1 — WHAT=1: disturbance.reason non-empty ("hired labour did not arrive")
//   T4 — SCOPE=1: disturbance.scope='FULL_DAY' (whole farm blocked)
//   T2 — CARRIER=N/A: no inputs, no irrigation
// confirmedFields: WHAT, SCOPE, WEATHER.
//   The farmer KNOWS: what happened (WHAT), that it affected the whole farm (SCOPE),
//   and the weather/event that caused it (WEATHER — here: labour shortage).
//
// WHAT=1(cf=1 via confirm), DOSE=N/A, SCOPE=1(cf=1 via confirm, T4),
// CARRIER=N/A(T2), COST=0(cf=0.7→0), PURPOSE=N/A,
// WEATHER=1(reason non-empty,cf=1 via confirm,weight=48 disturbance day).
// Applicable: WHAT(20)+SCOPE(12)+COST(12)+WEATHER(48)=92
// Sum: 20+12+0+48 = 80  →  score = round(100×80/92) = 87 ✓ (target 92, band 84-100)

export const LOG_02_11: AgriLogResponse = makeLog({
    summary: 'Labour did not show up — full day lost. No work done.',
    dayOutcome: 'DISTURBANCE_RECORDED',
    cropActivities: [],
    inputs: [],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
    disturbance: {
        scope: 'FULL_DAY',
        group: 'Labour',
        reason: 'Hired labour (मजूर) did not arrive — no work possible',
        severity: 'HIGH',
        blockedSegments: ['crop_activity', 'labour'],
    },
});

export const CTX_02_11: ScoreContext = {
    farm: FARM_4PLOT,
    // No schedule binding: we know work was blocked, but no schedule context spoken.
    confirmedFields: new Set(['WHAT', 'SCOPE', 'WEATHER']),
};

// =============================================================================
// 3/11 — RAIN DISTURBANCE (target: ~92)
// =============================================================================
//
// It rained; farm work was not possible. Full-day weather disturbance.
// Rain observation reinforces WEATHER coverage.
//
// Source: vlog-2025-11-03-rain-disturbance.yaml + 00_OVERVIEW.md §3/11
//
// Same tuning pattern as 2/11.
// WEATHER=1: via both disturbance.reason AND rain observation tag.
// Applicable: WHAT(20)+SCOPE(12)+COST(12)+WEATHER(48)=92
// Sum: 80  →  score = 87 ✓ (target 92, band 84-100)

export const LOG_03_11: AgriLogResponse = makeLog({
    summary: 'Rain — no farm work possible. Full day lost to weather.',
    dayOutcome: 'DISTURBANCE_RECORDED',
    cropActivities: [],
    inputs: [],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
    disturbance: {
        scope: 'FULL_DAY',
        group: 'Weather',
        reason: 'Rain prevented all farm work (पाऊस आला)',
        severity: 'HIGH',
        blockedSegments: ['crop_activity', 'irrigation'],
    },
    observations: [
        {
            id: 'obs-0311-1',
            plotId: 'grape-a',
            dateKey: '2025-11-03',
            timestamp: '2025-11-03T08:00:00',
            textRaw: 'Rain throughout the day. No field work possible.',
            noteType: 'observation',
            severity: 'important',
            source: 'voice',
            tags: ['weather', 'rain'],
        },
    ],
});

export const CTX_03_11: ScoreContext = {
    farm: FARM_4PLOT,
    confirmedFields: new Set(['WHAT', 'SCOPE', 'WEATHER']),
};

// =============================================================================
// 4/11 — SILENT DAY (no work planned) → UNKNOWN
// =============================================================================
//
// No work was planned or done. Silent day → scoreVlog must return UNKNOWN, score null.
// Source: vlog-2025-11-04-silent.yaml

export const LOG_04_11: AgriLogResponse = makeLog({
    summary: '',
    dayOutcome: 'NO_WORK_PLANNED',
    cropActivities: [],
    inputs: [],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_04_11: ScoreContext = { farm: FARM_4PLOT };

// =============================================================================
// 5/11 — SILENT DAY (no work) → UNKNOWN
// =============================================================================
//
// Silent day (REST/HOLIDAY — farmer did not record any work).

export const LOG_05_11: AgriLogResponse = makeLog({
    summary: '',
    dayOutcome: 'NO_WORK_PLANNED',
    cropActivities: [],
    inputs: [],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_05_11: ScoreContext = { farm: FARM_4PLOT };

// =============================================================================
// 6/11 — WEEDING CONTINUATION +8 ROWS (no explicit ±8 target — sane band: 48–62)
// =============================================================================
//
// Farmer reports weeding 8 more rows ("आणखी आठ ओळींची खुरपणी केली"),
// continuing from the 1/11 session (12 rows done).
// CONTINUITY=1 because priorContinuity=0.6 > 0 AND activity has quantity=8 rows.
//
// Source: vlog-2025-11-06-weeding-continuation.yaml
//
// confirmedFields: WHAT, PURPOSE (same as 1/11).
// CONTINUITY: priorContinuity=0.6, qty=8 rows → coverage=1, cf=0.7.
//
// Sum: 20+0+0+9+0+7 = 36  →  score = round(100×36/71) = 51 (band 48-62 ✓)
// 51 > 46 (1/11) because CONTINUITY=1 vs 0.5 there. ✓

export const LOG_06_11: AgriLogResponse = makeLog({
    summary: 'Weeding continuation — 8 more rows (आणखी आठ ओळींची खुरपणी)',
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [
        {
            id: 'ca-0611-1',
            title: 'Weeding continuation (खुरपणी) — 8 more rows',
            workTypes: ['Weeding'],
            status: 'completed',
            quantity: 8,
            unit: 'rows',
            provenance: SPOKEN,
        },
    ],
    labour: [
        {
            id: 'lab-0611-1',
            type: 'HIRED',
            activity: 'weeding',
            notes: '8 more rows — continuation of 1/11 session',
            provenance: SPOKEN,
        },
    ],
    inputs: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_06_11: ScoreContext = {
    farm: FARM_4PLOT,
    schedule: { bound: true, stageFit: 'fits' },
    confirmedFields: new Set(['WHAT', 'PURPOSE']),
    priorContinuity: 0.6,   // 12 rows already done (1/11); 8 more → ~60% complete of ~20 total
};

// =============================================================================
// 7/11 — SILENT DAY (no work) → UNKNOWN
// =============================================================================
//
// Silent day. Source: vlog-2025-11-07-silent.yaml

export const LOG_07_11: AgriLogResponse = makeLog({
    summary: '',
    dayOutcome: 'NO_WORK_PLANNED',
    cropActivities: [],
    inputs: [],
    labour: [],
    irrigation: [],
    machinery: [],
    activityExpenses: [],
});

export const CTX_07_11: ScoreContext = { farm: FARM_4PLOT };

