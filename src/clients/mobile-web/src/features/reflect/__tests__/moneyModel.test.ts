/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6; lane RF)
 *
 * उत्पन्न आणि खर्च — the in-hand income card, the totals so far, the recent-days chart (by day / crop / plot), the
 * spend mix and a plot card's day money — from the SERVER's cost ledger (lane RF), never a log's own total. The
 * rules under test as much as the arithmetic (P4): nothing recorded → `null` ("—"), never ₹ 0; money he may not see
 * → hidden, no amount; a total from an incomplete set → `partial`, with why.
 */
import { describe, expect, it } from 'vitest';
import {
    EMPTY_LEDGER, buildInHand, buildSeasonTotals, buildSpend, plotDayMoney, spendRange, topOf,
    type Ledger, type LedgerEntry, type LedgerGap,
} from '../overview/moneyModel';
import { pickCrop, selectAll, togglePlot, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, TODAY_KEY, session } from './reflectFixtures';
import type { HarvestSession } from '../../logs/harvest.types';

const all = toViewScope(CROPS, selectAll(CROPS));
const grapeOnly = toViewScope(CROPS, pickCrop(CROPS, 'grape'));
const noSessions = () => [];

const spent = (id: string, amount: number, dateKey: string, plotId?: string, category: LedgerEntry['category'] = 'Other'): LedgerEntry =>
    ({ id, amount, dateKey, direction: 'Expense', category, ...(plotId ? { plotId } : {}) });
const received = (id: string, amount: number, dateKey: string, plotId?: string): LedgerEntry =>
    ({ id, amount, dateKey, direction: 'Income', category: 'Other', ...(plotId ? { plotId } : {}) });
const ledgerOf = (entries: LedgerEntry[], gaps: LedgerGap[] = []): Ledger => ({ entries, gaps });

describe('buildInHand (the in-hand income card) — the ledger\'s income', () => {
    const ledger = ledgerOf([received('s1', 40000, '2026-10-01', 'g1'), received('s2', 90000, '2026-10-02', 'c1'), received('o1', 2500, '2026-10-03')]);

    it('whole farm: every income entry, the whole-farm one too; one crop: only its plots\' income', () => {
        expect(buildInHand(ledger, CROPS, all, true)).toEqual({ amount: 132500, hidden: false, partial: [] });
        expect(buildInHand(ledger, CROPS, grapeOnly, true).amount).toBe(40000);
    });

    it('nothing received yet → null, not ₹ 0', () => {
        expect(buildInHand(EMPTY_LEDGER, CROPS, all, true)).toEqual({ amount: null, hidden: false, partial: [] });
    });

    it('money he may not see → hidden, no amount at all', () => {
        expect(buildInHand(ledger, CROPS, all, false)).toEqual({ amount: null, hidden: true, partial: [] });
    });
});

describe('buildSeasonTotals (आतापर्यंत)', () => {
    const ledger = ledgerOf([
        spent('a', 3000, '2026-09-02', 'g1', 'Labour'),
        spent('b', 1200, '2026-10-20', 'c1'),
        spent('f', 800, '2026-10-21'), // a whole-farm cost
        received('x', 50000, '2026-10-01', 'g1'),
        received('y', 1000, '2026-10-02', 'c1'),
    ]);
    const sessionsFor = (list: HarvestSession[]) => (plotId: string, cropId: string) => list.filter(s => s.plotId === plotId && s.cropId === cropId);

    it('whole farm: every cost (the farm-wide one too), every income, income − cost; harvest entries per crop', () => {
        const t = buildSeasonTotals(ledger, CROPS, all, sessionsFor([session('s1', 'g1', 'grape', { harvestEntries: [{ id: 'h1' }, { id: 'h2' }] as never })]), true);
        expect(t.cost.amount).toBe(5000);
        expect(t.income.amount).toBe(51000);
        expect(t.net.amount).toBe(46000);
        expect(t.harvest).toEqual([
            { cropId: 'grape', cropName: 'द्राक्ष', color: 'bg-purple-500', entries: 2 },
            { cropId: 'cane', cropName: 'ऊस', color: 'bg-emerald-500', entries: 0 },
        ]);
    });

    it('one crop: only its plots; a farm-wide cost is no crop\'s', () => {
        const t = buildSeasonTotals(ledger, CROPS, grapeOnly, noSessions, true);
        expect(t.cost.amount).toBe(3000);
        expect(t.income.amount).toBe(50000);
    });

    it('nothing recorded → every figure null; income missing → no net (an unrecorded income is not ₹ 0)', () => {
        expect(buildSeasonTotals(EMPTY_LEDGER, CROPS, all, noSessions, true)).toMatchObject({ cost: { amount: null }, income: { amount: null }, net: { amount: null } });
        const costOnly = buildSeasonTotals(ledgerOf([spent('a', 3000, TODAY_KEY, 'g1')]), CROPS, all, noSessions, true);
        expect(costOnly).toMatchObject({ cost: { amount: 3000 }, income: { amount: null }, net: { amount: null } });
    });

    it('money he may not see: every figure hidden, the harvest progress (not money) still shown', () => {
        const t = buildSeasonTotals(ledger, CROPS, all, noSessions, false);
        expect([t.cost, t.income, t.net].every(f => f.hidden && f.amount === null)).toBe(true);
        expect(t.harvest).toHaveLength(2);
    });

    it('a total from an incomplete set says it is partial, and why', () => {
        const gaps: LedgerGap[] = [{ plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense' }];
        const notYet = buildSeasonTotals(ledgerOf([spent('a', 3000, TODAY_KEY, 'g1')], gaps), CROPS, all, noSessions, true);
        expect(notYet.cost).toEqual({ amount: 3000, hidden: false, partial: ['notOnServer'] });
        expect(notYet.income.partial).toEqual([]); // the money not yet on the server was spent, not received
        const unknown: LedgerEntry = { id: 'u', amount: 9999, dateKey: TODAY_KEY, direction: 'Unknown', category: 'Other', plotId: 'g1' };
        const old = buildSeasonTotals(ledgerOf([spent('a', 3000, TODAY_KEY, 'g1'), unknown]), CROPS, all, noSessions, true);
        // an amount that never said which way it went is in NEITHER total — it makes both partial instead
        expect(old.cost).toEqual({ amount: 3000, hidden: false, partial: ['unknownDirection'] });
        expect(old.income.amount).toBeNull();
        // a gap on a plot outside the view does not make the view's total partial
        expect(buildSeasonTotals(ledgerOf([spent('a', 3000, TODAY_KEY, 'g1')], [{ plotId: 'c1', dateKey: TODAY_KEY, direction: 'Expense' }]), CROPS, grapeOnly, noSessions, true).cost.partial).toEqual([]);
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

describe('buildSpend (the recent-days chart and the mix) — the ledger\'s spent entries', () => {
    const week = spendRange('week', TODAY, TODAY);
    const ledger = ledgerOf([
        spent('a', 2000, '2026-10-25', 'g1', 'Labour'),
        spent('a2', 1000, '2026-10-25', 'g2', 'Input'),
        spent('b', 500, '2026-10-23', 'c1', 'Machinery'),
        spent('b2', 300, '2026-10-23', 'c1', 'Transport'),
        spent('f', 400, '2026-10-22'),
        received('r', 7000, '2026-10-24', 'g1'),
        spent('old', 9999, '2026-10-10', 'g1'),
    ]);

    it('day by day, only inside the range; income is not spending', () => {
        const s = buildSpend(ledger, CROPS, all, week, true);
        expect(s.points.map(p => p.value)).toEqual([0, 0, 0, 400, 800, 0, 3000]);
        expect(s.points[6]).toMatchObject({ key: '2026-10-25', label: 'रवि' });
        expect(s.total.amount).toBe(4200);
    });

    it('by plot and by crop: each entry on its own plot; the farm-wide cost belongs to no plot', () => {
        const s = buildSpend(ledger, CROPS, all, week, true);
        expect(s.byPlot.map(b => [b.key, b.value])).toEqual([['g1', 2000], ['g2', 1000], ['c1', 800]]);
        expect(s.byCrop.map(b => [b.key, b.value])).toEqual([['grape', 3000], ['cane', 800]]);
        expect(s.byPlot[0]).toMatchObject({ label: 'सोनाका', color: 'bg-purple-500' });
    });

    it('what the money went on, by the ledger\'s own category: मजुरी / खत-औषध / यंत्र / इतर', () => {
        expect(buildSpend(ledger, CROPS, all, week, true).mix).toEqual({ labour: 2000, inputs: 1000, machinery: 500, other: 700 });
    });

    it('follows the picked plots, and a narrowed view leaves the farm-wide cost out', () => {
        const s = buildSpend(ledger, CROPS, toViewScope(CROPS, togglePlot(CROPS, pickCrop(CROPS, 'grape'), 'g2')), week, true);
        expect(s.total.amount).toBe(2000);
        expect(s.mix).toEqual({ labour: 2000, inputs: 0, machinery: 0, other: 0 });
    });

    it('no cost recorded in the range → total null, no mix', () => {
        const s = buildSpend(EMPTY_LEDGER, CROPS, all, week, true);
        expect(s.total.amount).toBeNull();
        expect(s.mix).toBeNull();
        expect(s.points).toHaveLength(7);
    });

    it('hidden money: no total, no bars, no mix', () => {
        const s = buildSpend(ledger, CROPS, all, week, false);
        expect(s.total).toEqual({ amount: null, hidden: true, partial: [] });
        expect(s.points.every(p => p.value === 0)).toBe(true);
        expect(s.byPlot.every(b => b.value === 0)).toBe(true);
        expect(s.mix).toBeNull();
    });

    it('a gap inside the range makes the week partial; one outside it does not', () => {
        expect(buildSpend(ledgerOf(ledger.entries as LedgerEntry[], [{ dateKey: '2026-10-24', direction: 'Expense' }]), CROPS, all, week, true).total.partial).toEqual(['notOnServer']);
        expect(buildSpend(ledgerOf(ledger.entries as LedgerEntry[], [{ dateKey: '2026-09-01', direction: 'Expense' }]), CROPS, all, week, true).total.partial).toEqual([]);
    });

    it('month: one bar per week (weeks start on Monday, as the old chart\'s did)', () => {
        const s = buildSpend(ledger, CROPS, all, spendRange('month', TODAY, TODAY), true);
        expect(s.points.map(p => p.key)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
        expect(s.points.map(p => p.value)).toEqual([0, 9999, 0, 4200, 0]);
    });
});

describe('plotDayMoney (a plot card\'s money)', () => {
    const ledger = ledgerOf([spent('a', 1500, TODAY_KEY, 'g1'), spent('b', 250, TODAY_KEY, 'g1'), spent('c', 700, '2026-10-24', 'g1'), spent('d', 90, TODAY_KEY, 'g2')]);

    it('what the ledger holds as spent on that plot that day', () => {
        expect(plotDayMoney(ledger, 'g1', TODAY_KEY, true)).toEqual({ amount: 1750, hidden: false, partial: [] });
        expect(plotDayMoney(ledger, 'c1', TODAY_KEY, true).amount).toBeNull();
        expect(plotDayMoney(ledger, undefined, TODAY_KEY, true).amount).toBeNull();
    });

    it('partial when money told for that plot-day has not reached the ledger; hidden when not his to see', () => {
        expect(plotDayMoney(ledgerOf(ledger.entries as LedgerEntry[], [{ plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense' }]), 'g1', TODAY_KEY, true).partial).toEqual(['notOnServer']);
        expect(plotDayMoney(ledger, 'g1', TODAY_KEY, false)).toEqual({ amount: null, hidden: true, partial: [] });
    });
});

describe('topOf', () => {
    it('the biggest bar, or nothing when nothing was spent', () => {
        expect(topOf([{ key: 'a', label: 'अ', value: 3 }, { key: 'b', label: 'ब', value: 9 }])).toEqual({ key: 'b', label: 'ब', value: 9 });
        expect(topOf([{ key: 'a', label: 'अ', value: 0 }])).toBeUndefined();
    });
});
