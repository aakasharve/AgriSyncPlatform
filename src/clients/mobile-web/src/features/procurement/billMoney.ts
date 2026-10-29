/**
 * spec: pre-launch-repair L2a (R-6; D-12 / D-41) — the money a saved bill sends, decided in ONE place so the
 * save (`ReceiptCaptureSheet`) and the खरेदी state (`ProcurementPage`) read the same list.
 *
 *   - one money entry per bill line that HAS an amount; a line nobody read an amount for is not sent as ₹0;
 *   - a bill whose lines carry no amount sends ONE entry for its confirmed total — a total-only expense is
 *     valid (D-41) — and a bill with no total sends nothing;
 *   - a rate nobody read stays absent (it used to be sent as 0), and so does the payment: nothing says
 *     "paid" or "cash" unless the bill said so (it used to be 'PAID' → 'Cash' on every bill).
 *
 * The `sourceId` is the bill's own `<billId>:<lineId>` (or `<billId>:total`), the same key the money
 * entry carries as its description — which is how the खरेदी state finds a bill's entries again.
 */
import type { ProcurementExpense } from './procurement.types';
import type { MoneyCategory } from '../finance/finance.types';

export interface BillMoneyLine {
    sourceId: string;
    amount: number;
    category: MoneyCategory;
    qty?: number;
    unit?: string;
    unitPrice?: number;
}

export const mapExpenseCategoryToMoneyCategory = (category: string): MoneyCategory => {
    if (category === 'LABOUR') return 'Labour';
    if (category === 'FUEL') return 'Fuel';
    if (category === 'MACHINERY_RENTAL') return 'Machinery';
    if (category === 'TRANSPORT') return 'Transport';
    if (category === 'ELECTRICITY') return 'Electricity';
    if (category === 'EQUIPMENT_REPAIR') return 'Repair';
    if (['FERTILIZER', 'PESTICIDE', 'FUNGICIDE', 'SEEDS_PLANTS', 'IRRIGATION'].includes(category)) return 'Input';
    return 'Other';
};

/** `true` when a number was actually given (a read or typed amount); 0, NaN and nothing are "not given". */
export const isGivenAmount = (value: number | undefined | null): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

export function billMoneyLines(bill: Pick<ProcurementExpense, 'id' | 'lineItems' | 'grandTotal'>): BillMoneyLine[] {
    const lines = bill.lineItems
        .filter(item => isGivenAmount(item.totalAmount))
        .map(item => ({
            sourceId: `${bill.id}:${item.id}`,
            amount: item.totalAmount,
            category: mapExpenseCategoryToMoneyCategory(item.category),
            qty: item.quantity,
            unit: item.unit,
            unitPrice: isGivenAmount(item.unitPrice) ? item.unitPrice : undefined,
        }));
    if (lines.length > 0) return lines;
    return isGivenAmount(bill.grandTotal)
        ? [{ sourceId: `${bill.id}:total`, amount: bill.grandTotal, category: 'Other' }]
        : [];
}

/** Only a payment the bill itself stated; today the bill sheet states none, so this is absent. */
export function billPaymentMode(bill: Pick<ProcurementExpense, 'paymentStatus'>): 'Credit' | undefined {
    return bill.paymentStatus === 'CREDIT' ? 'Credit' : undefined;
}
