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
 *
 * TASK 29 (spec: 2026-08-28-labour-v2-release-1) — that consolidation ended
 * the inconsistency by standardising every screen onto the WRONG answer.
 * All three fields are optional, so a farmer who says "मजुरांनी छाटणी केली"
 * ("the workers did the pruning") without ever stating a number produced an
 * event with no counts at all, and this returned `0` — zero workers, for a
 * job workers demonstrably did, farmer-reachable on the reflect page
 * (CompactCropCard) and the day summary (dayWorkSummary).
 *
 * Governing rule (R8): absence of any record means UNKNOWN; a record that
 * exists and contains nothing is a genuine zero. THREE cases, and collapsing
 * any two of them is how this goes wrong:
 *
 *   1. No labour events at all        → `0`         (honest: no labour happened)
 *   2. Events exist, none states any  → `undefined` (unknown — NOT `0`)
 *   3. Some state counts, some do not → the sum of the known ones
 *
 * This MIRRORS the server, it is not a second client-side rule: case 2 is
 * `LabourHeadcount.Resolve`'s all-null guard (ShramSafal.Domain/Farms/
 * LabourHeadcount.cs) and `GetLabourDataHandler`'s `All(h => h is null)`
 * gate; case 3 is that handler's `Sum(h => h ?? 0)` — "a known figure among
 * unknowns is never poisoned to null, and an unknown one never drags a known
 * sum down". Unknown renders as the em-dash everywhere (the codebase's
 * existing "we were not told" mark), never as a number.
 */

export interface HeadcountFields {
    count?: number;
    maleCount?: number;
    femaleCount?: number;
}

/**
 * Headcount for a SINGLE labour event. `count` wins when stated; otherwise the
 * gender split. `undefined` ONLY when all three are unstated — "we were not
 * told", never a fabricated 0. An explicitly stated `count: 0` is a different,
 * real fact ("nobody came") and still resolves to 0.
 */
export function resolveLabourHeadcount(event: HeadcountFields): number | undefined {
    if (event.count == null && event.maleCount == null && event.femaleCount == null) {
        return undefined; // nobody told us anything — absence of evidence, not zero.
    }
    if (typeof event.count === 'number' && event.count > 0) {
        return event.count;
    }
    return (event.maleCount || 0) + (event.femaleCount || 0);
}

/**
 * Total headcount across all of a day's labour events — the SAME per-event
 * rule, summed, with the three cases above kept distinct. Empty/absent is a
 * real `0` (no labour happened); all-unstated is `undefined` (labour happened,
 * nobody said how many).
 */
export function sumLabourHeadcount(events: readonly HeadcountFields[] | undefined): number | undefined {
    const labourEvents = events || [];
    if (labourEvents.length === 0) {
        return 0; // case 1: no labour events at all — a real zero.
    }

    const resolved = labourEvents.map(resolveLabourHeadcount);
    if (resolved.every(headcount => headcount == null)) {
        return undefined; // case 2: labour happened, headcount never stated.
    }

    // Case 3: real evidence exists — sum the known ones. Deliberately NOT a
    // plain `total + headcount` reduce: `undefined` would poison the sum to
    // NaN, and defaulting the whole thing back to 0 at the end would
    // reintroduce the very fabrication this function now removes.
    return resolved.reduce<number>((total, headcount) => total + (headcount ?? 0), 0);
}
