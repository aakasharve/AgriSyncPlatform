/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * उत्पन्न आणि खर्च — the in-hand income card, the totals so far, the recent-days chart (by day / crop /
 * plot), the spend mix — from the real logs' financial summaries and the real harvest + other-income
 * stores. The rule under test as much as the arithmetic: nothing recorded → `null` (the page shows "—"),
 * never ₹ 0 (P4).
 */
import { describe, expect, it } from 'vitest';
import { buildInHand, buildSeasonTotals, buildSpend, spendRange, topOf } from '../overview/moneyModel';
import { pickCrop, selectAll, togglePlot, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, farmLog, log, money, otherIncome, session } from './reflectFixtures';
import type { HarvestSession } from '../../logs/harvest.types';

const all = toViewScope(CROPS, selectAll(CROPS));
const grapeOnly = toViewScope(CROPS, pickCrop(CROPS, 'grape'));

const sessionsFrom = (list: HarvestSession[]) => (plotId: string, cropId: string) => list.filter(s => s.plotId === plotId && s.cropId === cropId);
const sale = (id: string, date: string, netAmount: number) => ({ id, date, netAmount, totalAmount: netAmount + 100 });

describe('buildInHand (the in-hand income card)', () => {
    it('sums the picked plots\' harvest income and the other income', () => {
        const sources = {
            sessionsFor: sessionsFrom([session('s1', 'g1', 'grape', { totalIncome: 40000 }), session('s2', 'c1', 'cane', { totalIncome: 90000 })]),
            otherIncome: [otherIncome('o1', 2500)],
        };
        expect(buildInHand(all, sources)).toBe(132500);
        expect(buildInHand(grapeOnly, sources)).toBe(42500);
    });

    it('nothing harvested or received yet → null, not ₹ 0', () => {
        expect(buildInHand(all, { sessionsFor: () => [], otherIncome: [] })).toBeNull();
    });
});

describe('buildSeasonTotals (आतापर्यंत)', () => {
    const logs = [
        log({ id: 'a', date: '2026-09-02', plotIds: ['g1'], financialSummary: money(3000) }),
        log({ id: 'b', date: '2026-10-20', cropId: 'cane', plotIds: ['c1'], financialSummary: money(0, 1200) }),
        farmLog({ id: 'f', date: '2026-10-21', financialSummary: money(0, 0, 0, 800) }),
    ];
    const sources = {
        sessionsFor: sessionsFrom([session('s1', 'g1', 'grape', {
            saleEntries: [sale('x', '2026-10-01', 50000)] as never,
            harvestEntries: [{ id: 'h1' }, { id: 'h2' }] as never,
        })]),
        otherIncome: [otherIncome('o1', 1000, { cropId: 'cane' })],
    };

    it('whole farm: every recorded cost (the farm-wide one too) and every recorded income', () => {
        const t = buildSeasonTotals(logs, CROPS, all, sources);
        expect(t.cost).toBe(5000);
        expect(t.income).toBe(51000);
        expect(t.net).toBe(46000);
        expect(t.harvest).toEqual([
            { cropId: 'grape', cropName: 'द्राक्ष', color: 'bg-purple-500', entries: 2 },
            { cropId: 'cane', cropName: 'ऊस', color: 'bg-emerald-500', entries: 0 },
        ]);
    });

    it('one crop: only that crop\'s cost and income; a farm-wide cost is not any crop\'s', () => {
        const t = buildSeasonTotals(logs, CROPS, grapeOnly, sources);
        expect(t.cost).toBe(3000);
        expect(t.income).toBe(50000);
    });

    it('nothing recorded → every figure null; income missing → no net (an unrecorded income is not ₹ 0)', () => {
        const none = buildSeasonTotals([], CROPS, all, { sessionsFor: () => [], otherIncome: [] });
        expect(none).toMatchObject({ cost: null, income: null, net: null });
        const costOnly = buildSeasonTotals(logs, CROPS, all, { sessionsFor: () => [], otherIncome: [] });
        expect(costOnly).toMatchObject({ cost: 5000, income: null, net: null });
    });
});

describe('spendRange', () => {
    it('week: the seven days ending on the chosen day, day by day', () => {
        expect(spendRange('week', TODAY, TODAY)).toMatchObject({ startKey: '2026-10-19', endKey: '2026-10-25', bucket: 'daily', label: '19 ऑक्टो – 25 ऑक्टो' });
    });
    it('month: the calendar\'s month, week by week', () => {
        expect(spendRange('month', TODAY, new Date(2026, 8, 10, 12))).toMatchObject({ startKey: '2026-09-01', endKey: '2026-09-30', bucket: 'weekly', label: 'सप्टेंबर 2026' });
    });
});

describe('buildSpend (the recent-days chart and the mix)', () => {
    const week = spendRange('week', TODAY, TODAY);
    const logs = [
        log({ id: 'a', date: '2026-10-25', plotIds: ['g1', 'g2'], financialSummary: money(2000, 1000) }),
        log({ id: 'b', date: '2026-10-23', cropId: 'cane', plotIds: ['c1'], financialSummary: money(0, 0, 500, 300) }),
        farmLog({ id: 'f', date: '2026-10-22', financialSummary: money(400) }),
        log({ id: 'old', date: '2026-10-10', plotIds: ['g1'], financialSummary: money(9999) }),
    ];

    it('day by day, only inside the range', () => {
        const s = buildSpend(logs, CROPS, all, week);
        expect(s.points.map(p => p.value)).toEqual([0, 0, 0, 400, 800, 0, 3000]);
        expect(s.points[6]).toMatchObject({ key: '2026-10-25', label: 'रवि' });
        expect(s.total).toBe(4200);
    });

    it('by plot and by crop: a two-plot record splits evenly; the farm-wide cost belongs to no plot', () => {
        const s = buildSpend(logs, CROPS, all, week);
        expect(s.byPlot.map(b => [b.key, b.value])).toEqual([['g1', 1500], ['g2', 1500], ['c1', 800]]);
        expect(s.byCrop.map(b => [b.key, b.value])).toEqual([['grape', 3000], ['cane', 800]]);
        expect(s.byPlot[0]).toMatchObject({ label: 'सोनाका', color: 'bg-purple-500' });
    });

    it('what the money went on: मजुरी / खत-औषध / यंत्र / इतर', () => {
        expect(buildSpend(logs, CROPS, all, week).mix).toEqual({ labour: 2400, inputs: 1000, machinery: 500, other: 300 });
    });

    it('follows the picked plots, and a narrowed view leaves the farm-wide cost out', () => {
        const s = buildSpend(logs, CROPS, toViewScope(CROPS, togglePlot(CROPS, pickCrop(CROPS, 'grape'), 'g2')), week);
        expect(s.total).toBe(1500);
        expect(s.mix).toEqual({ labour: 1000, inputs: 500, machinery: 0, other: 0 });
    });

    it('no cost recorded in the range → total null, no mix', () => {
        const s = buildSpend([], CROPS, all, week);
        expect(s.total).toBeNull();
        expect(s.mix).toBeNull();
        expect(s.points).toHaveLength(7);
    });

    it('month: one bar per week (weeks start on Monday, as the old chart\'s did)', () => {
        const s = buildSpend(logs, CROPS, all, spendRange('month', TODAY, TODAY));
        expect(s.points.map(p => p.key)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
        expect(s.points.map(p => p.value)).toEqual([0, 9999, 0, 4200, 0]);
    });
});

describe('topOf', () => {
    it('the biggest bar, or nothing when nothing was spent', () => {
        expect(topOf([{ key: 'a', label: 'अ', value: 3 }, { key: 'b', label: 'ब', value: 9 }])).toEqual({ key: 'b', label: 'ब', value: 9 });
        expect(topOf([{ key: 'a', label: 'अ', value: 0 }])).toBeUndefined();
    });
});
