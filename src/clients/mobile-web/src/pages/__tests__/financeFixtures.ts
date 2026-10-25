/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — shared test data for the पैसे व हिशोब page
 * tests. Test fixtures only: the names a farmer would type are Marathi, so any Latin letter left on a page
 * is a leftover of the English screens.
 */
import type { EffectiveMoneyEvent, FinancePipelineBucket, PriceBookItem } from '../../features/finance/finance.types';

export const ev = (
    id: string,
    type: EffectiveMoneyEvent['type'],
    category: EffectiveMoneyEvent['category'],
    amount: number,
    extra: Partial<EffectiveMoneyEvent> = {},
): EffectiveMoneyEvent => ({
    id, farmId: 'farm-1', dateTime: '2026-10-20T00:00:00Z', type, category, amount, effectiveAmount: amount,
    sourceType: 'Manual', sourceId: `src-${id}`, createdByUserId: 'u1', trustStatus: 'Unverified', reviewStatus: 'OK',
    reviewReasons: [], priceSource: 'Unknown', createdAt: '2026-10-20T10:00:00Z', adjustments: [], ...extra,
});

/** One of each kind the ledger has to tell apart. */
export const EVENTS: EffectiveMoneyEvent[] = [
    ev('e1', 'Income', 'Other', 50000, { notes: 'द्राक्ष विक्री', plotId: 'p1' }),
    ev('e2', 'Expense', 'Input', 1250, { notes: 'युरिया', sourceType: 'VoiceLog' }), // no plot: not split yet
    ev('e3', 'Expense', 'Labour', 4000, { jobCardId: 'jc-1', plotId: 'p1', dateTime: '2026-10-19T00:00:00Z' }),
    ev('e4', 'Unknown', 'Other', 700, { dateTime: '2026-10-18T00:00:00Z' }),
    ev('e5', 'Expense', 'Fuel', 30000, {
        plotId: 'p2', sourceType: 'Procurement', trustStatus: 'Adjusted',
        reviewStatus: 'NeedsReview', reviewReasons: ['High amount: >= 25000 INR'],
    }),
];

export const BUCKETS: FinancePipelineBucket[] = [
    { key: 'Captured', count: 5, total: 85950, topIssue: 'None' },
    { key: 'NeedsReview', count: 1, total: 30000, topIssue: 'High amount: >= 25000 INR' },
    { key: 'Approved', count: 0, total: 0, topIssue: 'None' },
    { key: 'Adjusted', count: 1, total: 30000, topIssue: 'None' },
];

export const RATES: PriceBookItem[] = [
    { id: 'pb1', name: 'फवारणी मजूर', category: 'Labour', defaultUnit: 'दिवस', defaultUnitPrice: 400, effectiveFrom: '2026-10-01', isActive: true },
    // What a rate read back from the server looks like (financeService `mapPriceConfig` placeholders).
    { id: 'pb2', name: 'Price Config', category: 'Other', defaultUnit: 'unit', defaultUnitPrice: 90, effectiveFrom: '2026-09-15T00:00:00Z', isActive: true },
];

/** Every Latin letter a farmer could read: text, placeholders, labels, alt text and tooltips. */
export function latinLeftovers(root: HTMLElement = document.body): string[] {
    const found: string[] = [...((root.textContent ?? '').match(/[A-Za-z]+/g) ?? [])];
    root.querySelectorAll('[placeholder],[aria-label],[alt],[title]').forEach(el => {
        for (const a of ['placeholder', 'aria-label', 'alt', 'title']) {
            const v = el.getAttribute(a);
            if (v && /[A-Za-z]/.test(v)) found.push(`${a}=${v}`);
        }
    });
    return found;
}
