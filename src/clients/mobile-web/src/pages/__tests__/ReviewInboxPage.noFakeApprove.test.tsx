// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I8 — X5; lane BILL-1, founder D-12)
//
// "Approve" on this page once sent a LOG verification carrying a money entry's id; the server
// refused it, nothing was recorded, and the local "verified" vanished on the next reload. Until a
// real approval path existed the page offered no approve control and said so.
//
// Lane BILL-1 gave it the real path (`approve_cost_entry`, a separate मंजूर stamp with who, when and
// which version). What this file now pins:
//   - a reviewer of THIS farm (the server's rule: the primary account holder or review money) sees
//     "मंजूर करा" on each bill the server sent with its version, and it queues the BILL approval —
//     never a log verification, never a local "verified";
//   - anyone else sees the entries and a plain Marathi line saying who approves, and no approve control;
//   - the approved preview's "बरोबर आहे" is still not carried over;
//   - the server's English reason is said in Marathi.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latinLeftovers } from './financeFixtures';
import { FarmContext } from '../../core/session/FarmContext';

const FARM = '11111111-1111-4111-8111-111111111111';
const ENTRY = {
    id: 'me-1', farmId: FARM, category: 'Input', dateTime: '2026-10-25T10:00:00Z', effectiveAmount: 30000,
    sourceType: 'Procurement', sourceId: 's-1', reviewReasons: ['HIGH_AMOUNT'], billVersion: 1,
};
const h = vi.hoisted(() => ({ inbox: [] as unknown[], approveBill: vi.fn() }));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: {
        getReviewInbox: () => h.inbox,
    },
}));
vi.mock('../../features/finance/components/FinanceManagerNav', () => ({ FinanceManagerNav: () => null }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/finance/components/MoneyChip', () => ({ MoneyChip: () => <span data-testid="money-chip" /> }));
vi.mock('../../features/finance/billApproval', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../features/finance/billApproval')>()),
    approveBill: h.approveBill,
    readBillApprovalOutbox: async () => ({ pending: new Set(), changed: new Map(), refused: new Map() }),
}));

import ReviewInboxPage from '../ReviewInboxPage';

const asSeat = (role: string, authorities?: { name: string }[], farmId = FARM) => ({
    currentFarmId: farmId,
    currentFarm: { role, ...(authorities ? { authorities } : {}) },
}) as never;

function drawAs(seat: unknown, onBack?: () => void) {
    return render(
        <FarmContext.Provider value={seat as never}>
            <ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} onBack={onBack} />
        </FarmContext.Provider>,
    );
}

beforeEach(() => { h.inbox = [ENTRY]; h.approveBill.mockReset(); h.approveBill.mockResolvedValue({}); });
afterEach(cleanup);

describe('the review inbox, now that a bill can be approved (D-12)', () => {
    it('a reviewer of this farm sees "मंजूर करा", and it queues the BILL approval for the version on screen', async () => {
        drawAs(asSeat('Mukadam', [{ name: 'SeeMoney' }, { name: 'ReviewMoney' }]));
        expect(screen.getByTestId('review-approve-meaning')).toHaveTextContent('बिल मंजूर म्हणजे हा खर्च तपासला. पैसे दिल्याची नोंद वेगळी आहे.');
        fireEvent.click(screen.getByTestId('bill-approve-me-1'));
        await waitFor(() => expect(h.approveBill).toHaveBeenCalledTimes(1));
        expect(h.approveBill).toHaveBeenCalledWith(expect.objectContaining({ id: 'me-1', farmId: FARM, billVersion: 1 }), undefined);
    });

    it('the primary account holder too; a bill of ANOTHER farm offers him nothing here', () => {
        h.inbox = [ENTRY, { ...ENTRY, id: 'me-9', sourceId: 's-9', farmId: '99999999-9999-4999-8999-999999999999' }];
        drawAs(asSeat('PrimaryOwner'));
        expect(screen.getByTestId('bill-approve-me-1')).toBeInTheDocument();
        expect(screen.queryByTestId('bill-approve-me-9')).toBeNull();
    });

    it('anyone else: the entries and a plain Marathi line saying who approves — no approve control', () => {
        drawAs(asSeat('Mukadam', [{ name: 'SeeMoney' }]));
        const line = screen.getByTestId('review-approve-meaning');
        expect(line).toHaveTextContent('श्रमसफलच्या नियमानुसार बिल मालक किंवा त्यांनी परवानगी दिलेली व्यक्ती मंजूर करते.');
        expect(latinLeftovers(line)).toEqual([]);
        expect(screen.getByTestId('money-chip')).toBeInTheDocument();
        expect(screen.queryByTestId('bill-approve-me-1')).toBeNull();
        expect(screen.queryByRole('button', { name: /approve|मंजूर करा/i })).toBeNull();
    });

    it('with no farm known yet (no seat), nothing to approve — fail closed', () => {
        render(<ReviewInboxPage currentRoute={'review-inbox' as never} onNavigate={vi.fn()} />);
        expect(screen.queryByTestId('bill-approve-me-1')).toBeNull();
        expect(latinLeftovers()).toEqual([]);
    });

    it('still no "बरोबर आहे" or resolve action — and nothing but मागे for a seat that may not approve', () => {
        drawAs(asSeat('Worker', []), vi.fn());
        expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['मागे']);
        expect(screen.queryByText(/बरोबर आहे|मंजूर केलं|approve|resolve/i)).toBeNull();
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
        drawAs(asSeat('PrimaryOwner'));
        // I8 review B005: not "everything has been checked", and no "these entries looked different" line over an empty inbox.
        expect(screen.getByTestId('review-empty')).toHaveTextContent('पाहण्यासारखी कोणतीही नोंद नाही');
        expect(document.body.textContent).not.toContain('तपासून झालं');
        expect(document.body.textContent).not.toContain('वेगळ्या दिसल्या');
        expect(screen.queryByTestId('review-approve-meaning')).toBeNull();
        // spec: pre-launch-repair L2a (R-7, D-18) — no promise the server does not keep: nothing sets a
        // double entry aside, so the page no longer says one "will come here".
        expect(document.body.textContent).not.toContain('इथे येईल');
        expect(document.body.textContent).not.toContain('दुहेरी नोंद');
    });
});
