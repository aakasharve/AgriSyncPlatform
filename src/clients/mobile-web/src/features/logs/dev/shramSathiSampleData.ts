/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * shramSathiSampleData — DEV-ONLY sample fixtures for the Shram Sathi preview.
 *
 * Representative VlogScore inputs (produced in the shape scoreVlog emits) that
 * exercise all five comprehension bands, plus a sample ClosureReceipt. These are
 * static fixtures for the founder-facing local preview ONLY — they are NOT wired
 * into any production path, never persisted, and carry no real farmer data.
 *
 * The bands are driven by the engine → visual mapping in MeterDisplay
 * (VlogScore.score ÷ 10 → 0–10 face scale):
 *   still-learning ≈ 2/10  (score 20)
 *   concerned      ≈ 4/10  (score 40)
 *   neutral        ≈ 6/10  (score 60)
 *   content        ≈ 8/10  (score 80)
 *   delighted      ≈ 10/10 (score 100, sparkle)
 *
 * Dimension rows are realistic so rankMeterGaps() surfaces genuine gap questions
 * (lower-scoring bands carry more uncovered dimensions).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { VlogScore, VlogScoreDimension } from '../../../domain/types/log.types';
import type { ClosureReceipt } from '../services/closureReceiptProjection';

/** Build a dimension row with a computed contribution (confidenceFactor = 1). */
function dim(
    dimension: string,
    applicable: boolean,
    coverage: 0 | 0.5 | 1,
    weight: number,
): VlogScoreDimension {
    return {
        dimension,
        applicable,
        weight,
        coverage,
        confidenceFactor: 1,
        contribution: applicable ? weight * coverage : 0,
    };
}

/**
 * One representative sample per comprehension band. Each is a plausible
 * scoreVlog output: the target /100 score with a dimension breakdown whose
 * uncovered rows drive the surfaced gap questions.
 */
export interface BandSample {
    /** Stable key + English label for the dev caption. */
    key: string;
    /** Short English descriptor of the band (dev caption only). */
    label: string;
    /** The real-engine-shaped score fed to MeterDisplay. */
    score: VlogScore;
}

export const BAND_SAMPLES: readonly BandSample[] = [
    {
        key: 'still-learning',
        label: 'Still learning (~2/10)',
        score: {
            score: 20,
            outcome: 'SCORED',
            dimensions: [
                dim('WHAT', true, 0.5, 20),
                dim('DOSE', true, 0, 20),
                dim('SCOPE', true, 0, 12),
                dim('COST', true, 0, 12),
                dim('CARRIER', true, 0, 10),
                dim('WEATHER', true, 0, 8),
            ],
        },
    },
    {
        key: 'concerned',
        label: 'Concerned (~4/10)',
        score: {
            score: 40,
            outcome: 'SCORED',
            dimensions: [
                dim('WHAT', true, 1, 20),
                dim('DOSE', true, 0.5, 20),
                dim('SCOPE', true, 0, 12),
                dim('COST', true, 0, 12),
                dim('CARRIER', true, 0.5, 10),
            ],
        },
    },
    {
        key: 'neutral',
        label: 'Getting it (~6/10)',
        score: {
            score: 60,
            outcome: 'SCORED',
            dimensions: [
                dim('WHAT', true, 1, 20),
                dim('DOSE', true, 1, 20),
                dim('SCOPE', true, 0.5, 12),
                dim('COST', true, 0.5, 12),
                dim('CARRIER', true, 0, 10),
            ],
        },
    },
    {
        key: 'content',
        label: 'Understood well (~8/10)',
        score: {
            score: 80,
            outcome: 'SCORED',
            dimensions: [
                dim('WHAT', true, 1, 20),
                dim('DOSE', true, 1, 20),
                dim('SCOPE', true, 1, 12),
                dim('COST', true, 0.5, 12),
                dim('CARRIER', true, 1, 10),
            ],
        },
    },
    {
        key: 'delighted',
        label: 'Fully understood (10/10, sparkle)',
        score: {
            score: 100,
            outcome: 'SCORED',
            dimensions: [
                dim('WHAT', true, 1, 20),
                dim('DOSE', true, 1, 20),
                dim('SCOPE', true, 1, 12),
                dim('COST', true, 1, 12),
                dim('CARRIER', true, 1, 10),
                dim('WEATHER', true, 1, 8),
            ],
        },
    },
] as const;

/**
 * An "arrived" log history: 20 rich logs (score > 50) so the arrival gate opens
 * and the face/band/gaps render for every sample above.
 */
export const ARRIVED_LOGS: Array<{ understanding?: VlogScore }> = Array.from(
    { length: 20 },
    () => ({ understanding: { score: 85, outcome: 'SCORED' as const, dimensions: [] } }),
);

/**
 * A "still arriving" log history: 12 rich logs (below the 20 threshold) so the
 * silhouette + arrival ticks (12/20) render — the reveal-in-progress state.
 */
export const ARRIVING_LOGS: Array<{ understanding?: VlogScore }> = Array.from(
    { length: 12 },
    () => ({ understanding: { score: 72, outcome: 'SCORED' as const, dimensions: [] } }),
);

/**
 * A sample Daily Closure Receipt (the shape closureReceiptProjection emits).
 * Static fixture — buckets, work-done rows, cost totals, weather, and the
 * understanding score, so the founder sees the end-of-day receipt card.
 */
export const SAMPLE_CLOSURE_RECEIPT: ClosureReceipt = {
    buckets: ['workDone', 'inputs', 'labour', 'expenses'],
    workDone: [
        { id: 'wd-1', sourceBucket: 'cropActivities', title: 'Pruning', detail: 'Plot A · 2 rows' },
        { id: 'wd-2', sourceBucket: 'inputs', title: 'Sprayed 19:19:19', detail: '2.5 kg · 200 L water' },
        { id: 'wd-3', sourceBucket: 'labour', title: '3 workers', detail: 'Rs 350 / person' },
    ],
    totals: {
        totalLabourCost: 1050,
        totalInputCost: 640,
        totalMachineryCost: 0,
        totalActivityExpenses: 120,
        grandTotal: 1810,
    },
    weather: {
        id: 'sample-weather',
        plotId: 'sample-plot',
        timestampLocal: '2026-07-03T18:30:00',
        timestampProvider: '2026-07-03T18:30:00Z',
        provider: 'mock',
        tempC: 31,
        humidity: 54,
        windKph: 9,
        precipMm: 0,
        cloudCoverPct: 12,
        conditionText: 'Clear sky',
        iconCode: 'clear',
        rainProbNext6h: 5,
    },
    score: BAND_SAMPLES[3].score, // "understood well" score on the receipt
};
