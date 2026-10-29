// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5)
//
// "Approve" on this page sent a LOG verification carrying a money entry's id; the server
// refused it, nothing was recorded, and the local "verified" vanished on the next reload.
// Until a real approval path exists (PENDING D-12) the page offers no approve control and
// says so — and nothing is queued.
//
// The redesign (तपासायचे) keeps that: the approved preview's "बरोबर आहे" / "दुरुस्त करा"
// buttons are NOT carried over, the honest line is now Marathi only, and the server's
// English reason is said in Marathi.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latinLeftovers } from './financeFixtures';

const ENTRY = {
    id: 'me-1', category: 'Input', dateTime: '2026-10-25T10:00:00Z', effectiveAmount: 30000,
    sourceType: 'Procurement', sourceId: 's-1', reviewReasons: ['HIGH_AMOUNT'],
};
const h = vi.hoisted(() => ({ inbox: [] as unknown[] }));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: {
        getReviewInbox: () => h.inbox,
    },
}));
vi.mock('../../features/finance/components/FinanceManagerNav', () => ({ FinanceManagerNav: () => null }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/finance/components/MoneyChip', () => ({ MoneyChip: () => <span data-testid="money-chip" /> }));

import ReviewInboxPage from '../ReviewInboxPage';

beforeEach(() => { h.inbox = [ENTRY]; });
afterEach(cleanup);

describe('the review inbox while approving has no server path', () => {
    it('shows the entries and an honest line, and offers no approve control', () => {
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        expect(screen.getByTestId('review-approve-unavailable')).toBeInTheDocument();
        expect(screen.getByTestId('money-chip')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
        expect(screen.queryByTitle('Approve')).toBeNull();
    });

    it('the honest line is plain Marathi, with no English half', () => {
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        const line = screen.getByTestId('review-approve-unavailable');
        expect(line).toHaveTextContent('मंजुरी अजून उपलब्ध नाही — खर्च दुरुस्त करायचा असेल तर रकमेवर दाबा.');
        expect(latinLeftovers(line)).toEqual([]);
        expect(latinLeftovers()).toEqual([]);
    });

    it('no approve or resolve action of any kind — not even the approved preview\'s', () => {
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} onBack={vi.fn()} />);
        // The only button on the page is "मागे"; the amount (mocked here) opens the money drawer.
        expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['मागे']);
        expect(screen.queryByText(/बरोबर आहे|मंजूर करा|मंजूर केलं|approve|resolve/i)).toBeNull();
    });

    it('says why the entry was set aside, in Marathi', () => {
        h.inbox = [ENTRY, { ...ENTRY, id: 'me-2', sourceId: 's-2', reviewReasons: ['High amount: >= 25000 INR'] }];
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        expect(screen.getByTestId('review-me-1')).toHaveTextContent('मोठी रक्कम');
        expect(screen.getByTestId('review-me-2')).toHaveTextContent('₹ 25,000 किंवा जास्त रक्कम');
        expect(screen.getByTestId('review-me-1')).toHaveTextContent('खत-औषध');
        expect(screen.getByTestId('review-me-1')).toHaveTextContent('25 ऑक्टो, 2026 · खरेदी');
    });

    it('with nothing to look at, it says so and shows no line about approving', () => {
        h.inbox = [];
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        // I8 review B005: not "everything has been checked" (there is no checking step yet), and no
        // "these entries looked different" line over an empty inbox.
        expect(screen.getByTestId('review-empty')).toHaveTextContent('पाहण्यासारखी कोणतीही नोंद नाही');
        expect(document.body.textContent).not.toContain('तपासून झालं');
        expect(document.body.textContent).not.toContain('वेगळ्या दिसल्या');
        expect(screen.queryByTestId('review-approve-unavailable')).toBeNull();
        // spec: pre-launch-repair L2a (R-7, D-18) — no promise the server does not keep: nothing sets a
        // double entry aside, so the page no longer says one "will come here".
        expect(document.body.textContent).not.toContain('इथे येईल');
        expect(document.body.textContent).not.toContain('दुहेरी नोंद');
    });
});
