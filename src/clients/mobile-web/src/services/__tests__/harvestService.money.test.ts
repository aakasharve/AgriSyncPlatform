// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (L2a review leftovers; R-1) — income money says only what the farmer said:
 *   - no payment mode unless stated (it was 'Cash' on every other-income entry and every harvest sale);
 *   - no ₹0 rate when a sale line gives none;
 *   - an income entry saved twice under the id its sheet minted is ONE entry and ONE money source.
 * Both copies of the harvest service are checked (the legacy `services/` one the sheets use, and
 * `features/finance/`). The money service is mocked; the stores are real (localStorage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMoneyEventFromSource = vi.fn();
vi.mock('../../features/finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...a: unknown[]) => createMoneyEventFromSource(...a) },
}));

import * as legacy from '../harvestService';
import * as feature from '../../features/finance/harvestService';
import type { HarvestSession } from '../../features/logs/harvest.types';

const income = { amount: 1200, source: 'OTHER' as const, description: 'भंगार', date: '2026-10-20' };

function session(pricePerUnit: number): HarvestSession {
    return {
        id: 'hs-1', plotId: 'p1', cropId: 'c1',
        saleEntries: [{
            id: 's1', date: '2026-10-21', totalQuantity: 10, totalAmount: 5000, netAmount: 4800, aiExtracted: false, userVerified: true,
            gradeWiseSales: [{ gradeId: 'g', gradeName: 'A', quantity: 10, unit: 'KG', pricePerUnit, totalAmount: 5000 }],
        }],
    } as unknown as HarvestSession;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.clearAllMocks());

describe.each([['services/harvestService', legacy], ['features/finance/harvestService', feature]])('%s', (_name, svc) => {
    it('other income: no payment mode — the farmer did not say how he was paid', () => {
        svc.addOtherIncomeEntry(income);
        const [payload] = createMoneyEventFromSource.mock.calls[0];
        expect(payload).not.toHaveProperty('paymentMode');
    });

    it('a harvest sale: no "Cash", and no ₹0 rate when the slip gives none', () => {
        svc.updateHarvestSession(session(0));
        const [payload] = createMoneyEventFromSource.mock.calls[0];
        expect(payload).not.toHaveProperty('paymentMode');
        expect(payload).not.toHaveProperty('unitPrice');
    });

    it('a stated rate still goes through', () => {
        svc.updateHarvestSession(session(500));
        expect(createMoneyEventFromSource.mock.calls[0][0]).toMatchObject({ unitPrice: 500 });
    });

    it('saved twice under the id its sheet minted: one stored entry, one money source', () => {
        svc.addOtherIncomeEntry({ ...income, id: 'inc_fixed' });
        svc.addOtherIncomeEntry({ ...income, id: 'inc_fixed' });
        expect(svc.getOtherIncomeEntries().filter(e => e.id === 'inc_fixed')).toHaveLength(1);
        const keys = createMoneyEventFromSource.mock.calls.map(c => (c[0] as { sourceId: string }).sourceId);
        expect(new Set(keys)).toEqual(new Set(['inc_fixed']));
    });
});
