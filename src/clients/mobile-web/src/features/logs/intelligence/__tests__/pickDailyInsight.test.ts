/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pickDailyInsight — unit tests (Task 1A TDD plan).
 *
 * Covers: rotation determinism (same date -> same pick), rotation
 * across dates (different date -> different pick within the
 * renderable set), all-unrenderable -> null, single-renderable ->
 * that one.
 *
 * spec: dfes-companion-2026-07-11
 */

import { describe, it, expect } from 'vitest';
import { pickDailyInsight } from '../pickDailyInsight';
import type { Insight } from '../insightTypes';

function insight(key: string, render: boolean): Insight {
    return { key, render, trustLabel: 'derived', line: `line-${key}` };
}

describe('pickDailyInsight', () => {
    it('is deterministic — the same date always returns the same pick', () => {
        const insights = [insight('a', true), insight('b', true), insight('c', true)];

        const first = pickDailyInsight(insights, '2026-07-13');
        const second = pickDailyInsight(insights, '2026-07-13');

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
    });

    it('rotates across the renderable set for different dates', () => {
        const insights = [insight('a', true), insight('b', true), insight('c', true)];

        const picks = new Set(
            ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'].map(
                (d) => pickDailyInsight(insights, d)?.key,
            ),
        );

        // Across 5 different dates and a 3-item renderable set, the pick
        // must vary (a pure hash-of-date-string mod 3 cannot legitimately
        // return the exact same single key for all 5 distinct inputs).
        expect(picks.size).toBeGreaterThan(1);
    });

    it('returns null when no insight is renderable', () => {
        const insights = [insight('a', false), insight('b', false)];

        expect(pickDailyInsight(insights, '2026-07-13')).toBeNull();
    });

    it('returns null for an empty insight list', () => {
        expect(pickDailyInsight([], '2026-07-13')).toBeNull();
    });

    it('returns the single renderable insight regardless of date', () => {
        const insights = [insight('a', false), insight('b', true), insight('c', false)];

        const result1 = pickDailyInsight(insights, '2026-01-01');
        const result2 = pickDailyInsight(insights, '2026-12-31');

        expect(result1?.key).toBe('b');
        expect(result2?.key).toBe('b');
    });

    it('only ever picks from the renderable subset', () => {
        const insights = [insight('a', false), insight('b', true), insight('c', true), insight('d', false)];

        for (const d of ['2026-01-01', '2026-03-15', '2026-08-22', '2026-11-30']) {
            const picked = pickDailyInsight(insights, d);
            expect(['b', 'c']).toContain(picked?.key);
        }
    });
});
