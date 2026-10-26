// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1; verifier I14-V3-06) — "आतापर्यंतची यादी"
 * on an old plot was 200+ rows of "ठिबकने पाणी · ठरलेला दिवस N · अजून नोंद नाही" (the wall PLR-D9 T7 called
 * overwhelming). `groupChecklist` folds the same kind of work into one row with its counts, keeping every item.
 */
import { describe, expect, it } from 'vitest';
import { groupChecklist } from '../CompareChecklist';
import type { MustDoItem } from '../comparePageHelpers';

const mk = (n: number, name: string, isDone: boolean, delayDays = 0): MustDoItem => ({
    id: `IRRIGATION_${name}_${n}`, category: 'IRRIGATION', name,
    plannedText: `ठरलेला दिवस ${n}`, actualText: isDone ? `झालं: दिवस ${n}` : 'अजून नोंद नाही',
    isDone, delayDays,
});

describe('groupChecklist — one row per kind of work, nothing dropped', () => {
    it('folds a 210-item wall of watering into ONE row with the true counts, every item kept in order', () => {
        // The builder hands items open-first, most delayed first (`buildCompareReport`), then done.
        const open = Array.from({ length: 150 }, (_, i) => mk(i, 'ठिबकने पाणी', false, 150 - i));
        const done = Array.from({ length: 60 }, (_, i) => mk(200 + i, 'ठिबकने पाणी', true));
        const groups = groupChecklist([...open, ...done]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ name: 'ठिबकने पाणी', done: 60, open: 150 });
        expect(groups[0].items).toHaveLength(210);
        expect(groups[0].items[0].plannedText).toBe('ठरलेला दिवस 0');
    });

    it('keeps the kinds apart, in the order they first appear (a kind with open work leads)', () => {
        const items = [
            mk(5, 'फवारणी', false, 30),
            mk(9, 'ठिबकने पाणी', false, 10),
            mk(12, 'ठिबकने पाणी', false, 2),
            mk(1, 'खत देणे', true),
            mk(3, 'फवारणी', true),
        ];
        const groups = groupChecklist(items);
        expect(groups.map(g => [g.name, g.done, g.open])).toEqual([
            ['फवारणी', 1, 1],
            ['ठिबकने पाणी', 0, 2],
            ['खत देणे', 1, 0],
        ]);
        // no item lost or duplicated
        expect(groups.reduce((sum, g) => sum + g.items.length, 0)).toBe(items.length);
    });

    it('an empty list is no rows', () => {
        expect(groupChecklist([])).toEqual([]);
    });
});
