/**
 * spec: pre-launch-repair L2a (R-6; D-12 / D-41) — the money a saved bill sends invents nothing: no ₹0 line,
 * no ₹0 rate, no "paid"/"cash"; a total-only bill is one entry for its total.
 */
import { describe, expect, it } from 'vitest';
import type { ProcurementExpense } from '../procurement.types';
import { billMoneyLines, billPaymentMode, isGivenAmount } from '../billMoney';

const line = (id: string, totalAmount: number, extra: Partial<ProcurementExpense['lineItems'][number]> = {}) =>
    ({ id, name: id, totalAmount, category: 'FERTILIZER' as const, ...extra });

describe('billMoneyLines', () => {
    it('one entry per line that has an amount; a line nobody read an amount for is not sent as ₹0', () => {
        const lines = billMoneyLines({ id: 'b1', grandTotal: 900, lineItems: [line('l1', 600, { quantity: 2, unit: 'पोती', unitPrice: 300 }), line('l2', 0)] });
        expect(lines).toEqual([{ sourceId: 'b1:l1', amount: 600, category: 'Input', qty: 2, unit: 'पोती', unitPrice: 300 }]);
    });

    it('a rate nobody read stays absent — never 0', () => {
        const [only] = billMoneyLines({ id: 'b2', grandTotal: 500, lineItems: [line('l1', 500, { unitPrice: 0 })] });
        expect(only.unitPrice).toBeUndefined();
        expect(only).not.toHaveProperty('paymentMode');
    });

    it('a total-only bill (no line amounts) is ONE entry for its confirmed total', () => {
        expect(billMoneyLines({ id: 'b3', grandTotal: 750, lineItems: [line('l1', 0)] }))
            .toEqual([{ sourceId: 'b3:total', amount: 750, category: 'Other' }]);
        expect(billMoneyLines({ id: 'b4', grandTotal: 750, lineItems: [] }))
            .toEqual([{ sourceId: 'b4:total', amount: 750, category: 'Other' }]);
    });

    it('a bill with no amount at all sends nothing (never a ₹0 expense)', () => {
        expect(billMoneyLines({ id: 'b5', grandTotal: 0, lineItems: [line('l1', 0)] })).toEqual([]);
    });
});

describe('billPaymentMode / isGivenAmount', () => {
    it('only a stated credit is a payment mode; nothing is ever "Cash" by default', () => {
        expect(billPaymentMode({ paymentStatus: undefined })).toBeUndefined();
        expect(billPaymentMode({ paymentStatus: 'PAID' })).toBeUndefined();
        expect(billPaymentMode({ paymentStatus: 'CREDIT' })).toBe('Credit');
    });

    it('0, NaN and nothing are "not given"', () => {
        expect([0, NaN, undefined, null, -5].map(isGivenAmount)).toEqual([false, false, false, false, false]);
        expect(isGivenAmount(1)).toBe(true);
    });
});
