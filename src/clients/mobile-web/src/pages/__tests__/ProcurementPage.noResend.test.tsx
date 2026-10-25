// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I4)
//
// The purchase tab used to turn EVERY stored receipt line into a money entry on every
// visit; after the money cache reloaded, the "already created" check could not see them,
// so each visit sent another copy of every bill. Opening the page must create nothing —
// a receipt becomes money once, when it is saved.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../features/context/components/SlidingCropSelector', () => ({ default: () => null }));
vi.mock('../../features/procurement/components/ExpenseSummaryCards', () => ({ ExpenseSummaryCards: () => null }));
vi.mock('../../features/procurement/components/ExpenseCard', () => ({ ExpenseCard: () => null }));
vi.mock('../../features/procurement/components/ReceiptCaptureSheet', () => ({ ReceiptCaptureSheet: () => null }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../services/procurementRepository', () => ({
    procurementRepository: {
        getExpenseSummary: () => ({}),
        getExpenses: () => [{
            id: 'exp-1', date: '2026-10-20', scope: 'FARM', vendorName: 'Krushi Kendra', paymentStatus: 'PAID',
            lineItems: [
                { id: 'li-1', name: 'Urea', category: 'FERTILIZER', quantity: 2, unit: 'bag', unitPrice: 300, totalAmount: 600 },
                { id: 'li-2', name: 'Diesel', category: 'FUEL', quantity: 10, unit: 'L', unitPrice: 95, totalAmount: 950 },
            ],
        }],
    },
}));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../features/finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...args: unknown[]) => createMoneyEventFromSource(...args) },
}));

import ProcurementPage from '../ProcurementPage';

afterEach(cleanup);

describe('opening the purchase tab', () => {
    it('creates no money entry, however many times it is opened', () => {
        const first = render(<ProcurementPage crops={[]} />);
        first.unmount();
        render(<ProcurementPage crops={[]} />);
        expect(createMoneyEventFromSource).not.toHaveBeenCalled();
    });
});
