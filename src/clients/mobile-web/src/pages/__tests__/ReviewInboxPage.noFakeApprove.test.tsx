// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5)
//
// "Approve" on this page sent a LOG verification carrying a money entry's id; the server
// refused it, nothing was recorded, and the local "verified" vanished on the next reload.
// Until a real approval path exists (PENDING D-12) the page offers no approve control and
// says so — and nothing is queued.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: {
        getReviewInbox: () => [{
            id: 'me-1', category: 'Input', dateTime: '2026-10-25T10:00:00Z', effectiveAmount: 30000,
            sourceType: 'Procurement', sourceId: 's-1', reviewReasons: ['HIGH_AMOUNT'],
        }],
    },
}));
vi.mock('../../features/finance/components/FinanceManagerNav', () => ({ FinanceManagerNav: () => null }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/finance/components/MoneyChip', () => ({ MoneyChip: () => <span data-testid="money-chip" /> }));

import ReviewInboxPage from '../ReviewInboxPage';

afterEach(cleanup);

describe('the review inbox while approving has no server path', () => {
    it('shows the entries and an honest line, and offers no approve control', () => {
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        expect(screen.getByTestId('review-approve-unavailable')).toBeInTheDocument();
        expect(screen.getByTestId('money-chip')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
        expect(screen.queryByTitle('Approve')).toBeNull();
    });
});
