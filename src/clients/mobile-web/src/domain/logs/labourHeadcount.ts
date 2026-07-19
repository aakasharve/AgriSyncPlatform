/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical headcount derivation for a `LabourEvent` (spec:
 * 2026-07-13-labour-attendance-approval-design, Phase 3 / Decision 3a,
 * 2026-07-19).
 *
 * A voice/manual labour entry states its headcount in ONE of two shapes,
 * never both additively:
 *   - a bare total: `count` (e.g. "चार माणसांनी काम केलं" — 4 people, no
 *     gender split spoken)
 *   - a gender split: `maleCount`/`femaleCount` (e.g. "५ बायका" — count=5 AND
 *     femaleCount=5 are BOTH set by the parser to the SAME total — see
 *     tests/ai-golden-set/dataset.json gold_002).
 *
 * Before this fix, `dayWorkSummary.ts`'s `generateLabourSummary` summed ONLY
 * maleCount/femaleCount (ignoring `count`), so a count-only entry rendered
 * "0 people" with a real cost attached — while `CompactCropCard` summed ONLY
 * `count` (ignoring maleCount/femaleCount) — two DIFFERENT, both-wrong
 * derivations for the same field. This is the ONE shared function every
 * screen must use so a given log's headcount reads identically everywhere
 * (log page, reflect page, labour hub "just logged" card).
 */

export interface HeadcountFields {
    count?: number;
    maleCount?: number;
    femaleCount?: number;
}

/** Headcount for a SINGLE labour event. `count` wins when stated; otherwise the gender split. */
export function resolveLabourHeadcount(event: HeadcountFields): number {
    if (typeof event.count === 'number' && event.count > 0) {
        return event.count;
    }
    return (event.maleCount || 0) + (event.femaleCount || 0);
}

/** Total headcount across all of a day's labour events — the SAME per-event rule, summed. */
export function sumLabourHeadcount(events: readonly HeadcountFields[] | undefined): number {
    return (events || []).reduce((total, event) => total + resolveLabourHeadcount(event), 0);
}
