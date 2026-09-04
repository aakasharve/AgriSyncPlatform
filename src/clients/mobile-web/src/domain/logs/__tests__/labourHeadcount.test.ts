/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 29 (spec: 2026-08-28-labour-v2-release-1) — the canonical headcount
 * derivation used by every screen that says "how many people worked".
 *
 * The defect: all three of `count`/`maleCount`/`femaleCount` are optional. A
 * farmer who says "मजुरांनी छाटणी केली" ("the workers did the pruning")
 * without ever stating a number produced an event with NO counts at all, and
 * `resolveLabourHeadcount` returned `0` — zero workers, for a job workers
 * demonstrably did. The function's own doc comment says it was written to end
 * "two DIFFERENT, both-wrong derivations for the same field"; it did that by
 * standardising every screen onto the wrong answer.
 *
 * Governing rule (R8): absence of any record means UNKNOWN; a record that
 * exists and contains nothing is a genuine zero. That is THREE cases, and
 * collapsing any two of them is how this fix goes wrong:
 *
 *   1. No labour events at all        → 0        (honest: no labour happened)
 *   2. Events exist, none states any  → undefined (unknown — NOT 0)
 *   3. Some state counts, some do not → sum of the known ones
 *
 * This mirrors the server's `LabourHeadcount.Resolve`
 * (ShramSafal.Domain/Farms/LabourHeadcount.cs) and `GetLabourDataHandler`'s
 * `All(h => h is null)` gate exactly — it is not a second, client-side rule.
 */
import { describe, it, expect } from 'vitest';
import { resolveLabourHeadcount, sumLabourHeadcount } from '../labourHeadcount';

describe('resolveLabourHeadcount — a single event (Task 29, spec: 2026-08-28-labour-v2-release-1)', () => {
    it('returns undefined when count/maleCount/femaleCount are ALL unstated — "we were not told", never a fabricated 0', () => {
        expect(resolveLabourHeadcount({})).toBeUndefined();
    });

    it('returns 0 for a genuinely stated 0 — a real fact ("nobody came"), not collapsed into unknown', () => {
        expect(resolveLabourHeadcount({ count: 0 })).toBe(0);
        expect(resolveLabourHeadcount({ maleCount: 0, femaleCount: 0 })).toBe(0);
    });

    it('lets a stated count win outright over the gender split (the parser emits count=5 AND femaleCount=5 for "५ बायका" — adding them double-counts)', () => {
        expect(resolveLabourHeadcount({ count: 5, femaleCount: 5 })).toBe(5);
    });

    it('sums the gender split when the bare count is unstated', () => {
        expect(resolveLabourHeadcount({ maleCount: 3, femaleCount: 1 })).toBe(4);
    });
});

describe('sumLabourHeadcount — a day\'s events (Task 29, spec: 2026-08-28-labour-v2-release-1)', () => {
    // ── CASE 1: no record of labour at all. 0 is honest — no labour happened.
    it('returns 0 for an empty list — no labour events at all is a real zero, not unknown', () => {
        expect(sumLabourHeadcount([])).toBe(0);
    });

    it('returns 0 for undefined — same case, reached via `log?.labour` on a log with no labour array', () => {
        expect(sumLabourHeadcount(undefined)).toBe(0);
    });

    // ── CASE 2: labour happened; nobody ever said how many. THE DEFECT.
    it('returns undefined when events exist but NONE states any count — the farmer-reachable defect ("मजुरांनी छाटणी केली")', () => {
        expect(sumLabourHeadcount([{}])).toBeUndefined();
    });

    it('returns undefined across MULTIPLE all-unstated events — one silence plus another silence is still silence, not 0', () => {
        expect(sumLabourHeadcount([{}, {}])).toBeUndefined();
    });

    // ── CASE 3: mixed. A known figure among unknowns is never poisoned to
    //    null, and an unknown one never drags a known sum down — the server's
    //    `Sum(h => h ?? 0)` over a not-all-null sequence, mirrored.
    it('sums only the KNOWN events when some state a count and some do not', () => {
        expect(sumLabourHeadcount([{ count: 4 }, {}])).toBe(4);
    });

    it('does not let an unstated event drag a known sum down, nor poison it to unknown', () => {
        expect(sumLabourHeadcount([{ count: 4 }, {}, { maleCount: 2, femaleCount: 1 }])).toBe(7);
    });

    // ── The opposite failure mode: over-correcting so a real zero disappears.
    it('keeps a genuinely stated 0 as 0 — a stated zero must NOT become unknown', () => {
        expect(sumLabourHeadcount([{ count: 0 }])).toBe(0);
    });

    it('sums normally when every event states a count', () => {
        expect(sumLabourHeadcount([{ count: 6 }, { maleCount: 3, femaleCount: 1 }])).toBe(10);
    });
});
