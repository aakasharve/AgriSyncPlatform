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

    it('achieves fair rotation — EVERY renderable key is picked at least once across 30 consecutive dates', () => {
        const insights = [insight('a', true), insight('b', true), insight('c', true)];

        // 2026-06-01 .. 2026-06-30, computed deterministically (no
        // Date.now()) — a weak "picks vary" check would pass even if
        // one key were starved across an entire month's rotation.
        const dates = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
        const pickedKeys = new Set(dates.map((d) => pickDailyInsight(insights, d)?.key));

        expect(pickedKeys).toEqual(new Set(['a', 'b', 'c']));
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
