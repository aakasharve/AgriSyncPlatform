/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * meterGaps — Understanding Meter gap-ranking service (1d-infra, no UI)
 *
 * Pure function: ranks applicable dimensions by leverage (weight × missingness)
 * to surface the most impactful gaps as Shram Sathi's next questions.
 *
 * Hard rules:
 * - No React, no DOM, no network, no Dexie, no styling, no asset refs, no flag.
 * - No `any`.
 * - UNKNOWN outcome → [] (no gaps on a silent/no-work day).
 * - Only APPLICABLE dimensions with coverage < 1 are ranked.
 * - Tie-break: descending by dimension weight, then lexicographic by dimension name.
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { VlogScore } from '../../../domain/types/log.types';

// =============================================================================
// OUTPUT TYPE
// =============================================================================

/**
 * A single ranked gap entry returned by rankMeterGaps.
 *
 * - dimension   : the scoring dimension key (e.g. 'DOSE', 'COST')
 * - leverage    : weight × missingness — higher = more impact if filled
 * - questionKey : stable lookup id, format `gap.<dimension>` (lower-cased)
 * - question    : draft first-person Marathi prompt (content placeholder;
 *                 final copy/UX finalized at the visual polish pass)
 */
export interface MeterGap {
    dimension: string;
    leverage: number;
    questionKey: string;
    question: string;
}

// =============================================================================
// DRAFT MARATHI QUESTION MAP (content placeholder — polish pass finalises copy)
// =============================================================================

/**
 * Dimension → draft Marathi first-person question.
 *
 * These are placeholder strings only. Font/UI treatment is deferred to the
 * visual polish pass (the founder will supply design assets + final copy).
 * The strings are Devanagari, which is the correct script for Marathi.
 */
const DIMENSION_QUESTION: Readonly<Record<string, string>> = {
    DOSE:       'किती मात्रा वापरली?',
    CARRIER:    'किती पाणी वापरलं?',
    COST:       'किती खर्च झाला?',
    SCOPE:      'कोणत्या प्लॉटवर?',
    WHAT:       'आज काय काम केलं?',
    PURPOSE:    'का केलं?',
    WEATHER:    'हवामान कसं होतं?',
    CONTINUITY: 'किती पूर्ण झालं?',
} as const;

/** Fallback question when a dimension is not in the map (future-proofing). */
function questionForDimension(dimension: string): string {
    return DIMENSION_QUESTION[dimension] ?? `${dimension} बद्दल सांगा?`;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * rankMeterGaps — rank the top-N comprehension gaps from a VlogScore.
 *
 * @param score    VlogScore output from scoreVlog.
 * @param maxGaps  Maximum number of gaps to return (default 3).
 * @returns        Ranked MeterGap[] sorted by leverage (weight × missingness)
 *                 descending; empty when outcome is UNKNOWN or there are no gaps.
 *
 * Algorithm:
 * 1. If outcome is UNKNOWN → return [] (silent day, nothing to ask).
 * 2. For each dimension that is APPLICABLE and has coverage < 1:
 *      missingness = 1 - coverage
 *      leverage    = weight × missingness
 * 3. Sort descending by leverage; ties broken by weight desc, then name asc.
 * 4. Take the top `maxGaps` entries.
 */
export function rankMeterGaps(score: VlogScore, maxGaps = 3): MeterGap[] {
    // Silent day → no questions to surface (UNKNOWN = no work done, not a gap)
    if (score.outcome === 'UNKNOWN') {
        return [];
    }

    const gaps: MeterGap[] = [];

    for (const dim of score.dimensions) {
        // Skip non-applicable dimensions (e.g. DOSE on a non-input-op day)
        if (!dim.applicable) continue;

        // Only surface real gaps (coverage < 1)
        const missingness = 1 - dim.coverage;
        if (missingness <= 0) continue;

        const leverage = dim.weight * missingness;

        gaps.push({
            dimension: dim.dimension,
            leverage,
            questionKey: `gap.${dim.dimension.toLowerCase()}`,
            question: questionForDimension(dim.dimension),
        });
    }

    // Rank: descending leverage; tie-break by weight desc, then dimension name asc
    gaps.sort((a, b) => {
        if (b.leverage !== a.leverage) return b.leverage - a.leverage;

        // Find weights from original dimensions for tie-breaking
        const wa = score.dimensions.find(d => d.dimension === a.dimension)?.weight ?? 0;
        const wb = score.dimensions.find(d => d.dimension === b.dimension)?.weight ?? 0;
        if (wb !== wa) return wb - wa;

        return a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0;
    });

    return gaps.slice(0, maxGaps);
}
