/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the rules behind खरेदी's list and totals, on their own.
 */
import { describe, expect, it } from 'vitest';
import type { CropProfile, ProcurementExpense } from '../../../../types';
import { ALL, billsInView, matchesSearch, totalsOf } from '../billView';

const CROPS = [
    { id: 'c1', name: 'द्राक्ष', plots: [{ id: 'p1', name: 'थॉम्पसन' }] },
    { id: 'c2', name: 'ऊस', plots: [{ id: 'p2', name: 'ऊस १' }] },
] as unknown as CropProfile[];

const bill = (id: string, scope: ProcurementExpense['scope'], grandTotal: number, extra: Partial<ProcurementExpense> = {}) =>
    ({ id, scope, grandTotal, lineItems: [], ...extra }) as unknown as ProcurementExpense;

describe('billView', () => {
    it('a plot bill saved with an empty cropId still belongs to the crop that holds its plot', () => {
        const b = bill('b1', 'PLOT', 100, { plotId: 'p1', cropId: '' });
        expect(billsInView([b], CROPS, { cropId: 'c1', plotId: ALL })).toEqual([b]);
        expect(billsInView([b], CROPS, { cropId: 'c2', plotId: ALL })).toEqual([]);
    });

    it('a bill not yet placed shows only under "सर्व", and counts in no total', () => {
        const b = bill('b1', 'UNKNOWN', 100);
        expect(billsInView([b], CROPS, { cropId: ALL, plotId: ALL })).toEqual([b]);
        expect(billsInView([b], CROPS, { cropId: 'c1', plotId: ALL })).toEqual([]);
        const t = totalsOf([b]);
        expect([t.plot.count, t.crop.count, t.farm.count]).toEqual([0, 0, 0]);
    });

    it('totals count each scope once and know when nothing is behind them', () => {
        const t = totalsOf([bill('a', 'PLOT', 100, { plotId: 'p1' }), bill('b', 'PLOT', 50, { plotId: 'p1' }), bill('c', 'FARM', 7)]);
        expect(t.plot).toEqual({ amount: 150, count: 2 });
        expect(t.plotCount).toBe(1);
        expect(t.crop).toEqual({ amount: 0, count: 0 });
        expect(t.farm).toEqual({ amount: 7, count: 1 });
    });

    it('search ignores surrounding spaces and matches shop or item', () => {
        const b = bill('b1', 'FARM', 1, { vendorName: 'महावितरण', lineItems: [{ name: 'वीज बिल' }] as ProcurementExpense['lineItems'] });
        expect(matchesSearch(b, '  ')).toBe(true);
        expect(matchesSearch(b, ' महावितरण ')).toBe(true);
        expect(matchesSearch(b, 'वीज')).toBe(true);
        expect(matchesSearch(b, 'डिझेल')).toBe(false);
    });
});
