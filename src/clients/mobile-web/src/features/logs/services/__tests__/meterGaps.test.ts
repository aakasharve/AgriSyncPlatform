/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * meterGaps — unit tests (1d-infra TDD plan)
 *
 * TDD cases from spec:
 * 1. DOSE coverage 0 (weight 20) + COST coverage 0.5 (weight 12) → DOSE ranks first
 *    (leverage 20×1=20 vs 12×0.5=6).
 * 2. Fully-covered score (all dims coverage=1 or not-applicable) → [].
 * 3. UNKNOWN outcome → [].
 * 4. maxGaps respected — only top N returned.
 * 5. Not-applicable dims excluded.
 * 6. Stable tie-break by weight desc then dimension name asc.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import { describe, it, expect } from 'vitest';
import { rankMeterGaps } from '../meterGaps';
import type { VlogScore, VlogScoreDimension } from '../../../../domain/types/log.types';

// =============================================================================
// FIXTURES
// =============================================================================

/** Build a minimal VlogScoreDimension. */
function makeDim(
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
        contribution: applicable ? weight * coverage * 1 : 0,
    };
}

/** Build a VlogScore with the given dimensions. */
function makeScore(
    dims: VlogScoreDimension[],
    outcome: VlogScore['outcome'] = 'SCORED',
    score: number | null = 50,
): VlogScore {
    return { score, outcome, dimensions: dims };
}

// =============================================================================
// TESTS
// =============================================================================

describe('rankMeterGaps', () => {
    // -------------------------------------------------------------------------
    // 1. Ranking order — DOSE (leverage 20) beats COST (leverage 6)
    // -------------------------------------------------------------------------
    it('ranks DOSE (coverage=0, weight=20) above COST (coverage=0.5, weight=12)', () => {
        const score = makeScore([
            makeDim('DOSE', true, 0, 20),    // missingness=1,  leverage=20
            makeDim('COST', true, 0.5, 12),  // missingness=0.5, leverage=6
            makeDim('WHAT', true, 1, 20),    // fully covered — should not appear
        ]);

        const gaps = rankMeterGaps(score);

        expect(gaps).toHaveLength(2);
        expect(gaps[0].dimension).toBe('DOSE');
        expect(gaps[0].leverage).toBe(20);
        expect(gaps[1].dimension).toBe('COST');
        expect(gaps[1].leverage).toBe(6);
    });

    // -------------------------------------------------------------------------
    // 2. Fully-covered score → []
    // -------------------------------------------------------------------------
    it('returns [] when all applicable dimensions are fully covered', () => {
        const score = makeScore([
            makeDim('WHAT', true, 1, 20),
            makeDim('DOSE', true, 1, 20),
            makeDim('SCOPE', true, 1, 12),
        ]);

        expect(rankMeterGaps(score)).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // 3. UNKNOWN outcome → []
    // -------------------------------------------------------------------------
    it('returns [] when outcome is UNKNOWN (silent day)', () => {
        const score = makeScore(
            [
                makeDim('WHAT', true, 0, 20),
                makeDim('COST', true, 0, 12),
            ],
            'UNKNOWN',
            null,
        );

        expect(rankMeterGaps(score)).toEqual([]);
    });

    // -------------------------------------------------------------------------
    // 4. maxGaps respected
    // -------------------------------------------------------------------------
    it('respects maxGaps — returns at most N gaps', () => {
        const score = makeScore([
            makeDim('DOSE',       true, 0,   20),  // leverage 20
            makeDim('WHAT',       true, 0,   20),  // leverage 20 (tie)
            makeDim('SCOPE',      true, 0,   12),  // leverage 12
            makeDim('CARRIER',    true, 0,   10),  // leverage 10
            makeDim('COST',       true, 0,   12),  // leverage 12
        ]);

        const top2 = rankMeterGaps(score, 2);
        expect(top2).toHaveLength(2);

        const top1 = rankMeterGaps(score, 1);
        expect(top1).toHaveLength(1);
    });

    // -------------------------------------------------------------------------
    // 5. Not-applicable dims excluded
    // -------------------------------------------------------------------------
    it('excludes not-applicable dimensions even if their coverage is 0', () => {
        const score = makeScore([
            makeDim('DOSE',    false, 0, 20),  // not applicable — must be excluded
            makeDim('COST',    true,  0, 12),  // applicable gap
        ]);

        const gaps = rankMeterGaps(score);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].dimension).toBe('COST');
    });

    // -------------------------------------------------------------------------
    // 6. DISTURBANCE days still rank gaps
    // -------------------------------------------------------------------------
    it('ranks gaps on DISTURBANCE days (not UNKNOWN)', () => {
        const score = makeScore(
            [
                makeDim('WEATHER', true, 0, 8),  // leverage 8
                makeDim('WHAT',    true, 1, 20),  // fully covered
            ],
            'DISTURBANCE',
            30,
        );

        const gaps = rankMeterGaps(score);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].dimension).toBe('WEATHER');
    });

    // -------------------------------------------------------------------------
    // 7. Question text and questionKey are present and stable
    // -------------------------------------------------------------------------
    it('attaches a Marathi question and stable questionKey to each gap', () => {
        const score = makeScore([
            makeDim('DOSE',  true, 0, 20),
            makeDim('COST',  true, 0.5, 12),
        ]);

        const gaps = rankMeterGaps(score);

        // DOSE
        expect(gaps[0].questionKey).toBe('gap.dose');
        expect(gaps[0].question).toBe('किती मात्रा वापरली?');

        // COST
        expect(gaps[1].questionKey).toBe('gap.cost');
        expect(gaps[1].question).toBe('किती खर्च झाला?');
    });

    // -------------------------------------------------------------------------
    // 8. Tie-break: same leverage → sort by weight desc, then name asc
    // -------------------------------------------------------------------------
    it('tie-breaks by weight desc then dimension name asc', () => {
        // DOSE and WHAT both have weight=20, coverage=0 → leverage=20 each.
        // DOSE < WHAT lexicographically → DOSE should win the tie.
        const score = makeScore([
            makeDim('WHAT', true, 0, 20),  // leverage 20, name W
            makeDim('DOSE', true, 0, 20),  // leverage 20, name D — lexically first
        ]);

        const gaps = rankMeterGaps(score, 2);
        expect(gaps[0].dimension).toBe('DOSE');
        expect(gaps[1].dimension).toBe('WHAT');
    });

    // -------------------------------------------------------------------------
    // 9. Default maxGaps = 3
    // -------------------------------------------------------------------------
    it('defaults to maxGaps=3 when not specified', () => {
        const score = makeScore([
            makeDim('DOSE',       true, 0, 20),
            makeDim('WHAT',       true, 0, 20),
            makeDim('SCOPE',      true, 0, 12),
            makeDim('CARRIER',    true, 0, 10),
        ]);

        expect(rankMeterGaps(score)).toHaveLength(3);
    });

    // -------------------------------------------------------------------------
    // 10. Partial coverage (0.5) produces correct leverage
    // -------------------------------------------------------------------------
    it('computes leverage correctly for coverage=0.5', () => {
        const score = makeScore([
            makeDim('SCOPE', true, 0.5, 12),  // missingness=0.5, leverage=6
        ]);

        const gaps = rankMeterGaps(score);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].leverage).toBeCloseTo(6);
    });
});
