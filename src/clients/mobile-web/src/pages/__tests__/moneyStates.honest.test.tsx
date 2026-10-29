// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2a (D-19 "honest upload states") — खरेदी and वही say where each bill / money entry
 * stands, from the sync evidence the app already keeps: पाठवणे बाकी (on this phone), शेतनोंदीत जमा ✓ (the
 * server acknowledged it), मदत कराल का? (needs the farmer) — and nothing at all while there is no evidence.
 * Never "on the server" before the server said so. The evidence read is mocked; the claim rule is real.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ evidence: null as unknown, events: [] as unknown[] }));
vi.mock('../../features/finance/moneyEntryState', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../features/finance/moneyEntryState')>()),
    useMoneyEvidence: () => h.evidence,
}));
vi.mock('../../features/procurement/components/ReceiptCaptureSheet', () => ({ ReceiptCaptureSheet: () => null }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/finance/financeSelectors', () => ({ financeSelectors: { getEffectiveMoneyEvents: () => h.events } }));
vi.mock('../../services/procurementRepository', () => ({
    procurementRepository: {
        getExpenses: () => [
            { id: 'b1', date: '2026-10-20', scope: 'FARM', vendorName: 'कृषी सेवा केंद्र', grandTotal: 900, subtotal: 900,
                lineItems: [{ id: 'l1', name: 'युरिया', category: 'FERTILIZER', totalAmount: 600 }, { id: 'l2', name: 'डिझेल', category: 'FUEL', totalAmount: 300 }],
                attachmentIds: ['att-1'], aiExtracted: true, userVerified: true, createdAt: '2026-10-20T10:00:00Z' },
        ],
    },
}));

import ProcurementPage from '../ProcurementPage';
import LedgerPage from '../LedgerPage';

const evidence = (over: object) => ({ rows: [], server: [], photos: new Map(), ...over });

beforeEach(() => { h.evidence = null; h.events = []; });
afterEach(cleanup);

describe('खरेदी — each bill says where its money and its photo stand', () => {
    it('no evidence yet → no claim at all', () => {
        render(<ProcurementPage crops={[]} />);
        expect(screen.queryByTestId('bill-state-b1')).toBeNull();
        expect(screen.queryByTestId('bill-photo-b1')).toBeNull();
    });

    it('a line still queued → on this phone (not "on the server"); the photo still to send', () => {
        h.evidence = evidence({
            rows: [{ description: 'b1:l2', status: 'PENDING', retryCount: 0 }],
            server: [{ description: 'b1:l1' }],
            photos: new Map([['att-1', 'pending']]),
        });
        render(<ProcurementPage crops={[]} />);
        expect(screen.getByTestId('bill-state-b1')).toHaveTextContent('पाठवणे बाकी');
        expect(screen.getByTestId('bill-state-b1')).not.toHaveTextContent('शेतनोंदीत जमा');
        expect(screen.getByTestId('bill-photo-b1')).toHaveTextContent('पाठवायचा बाकी');
    });

    it('every line acknowledged → on the server; the photo sent', () => {
        h.evidence = evidence({ server: [{ description: 'b1:l1' }, { description: 'b1:l2' }], photos: new Map([['att-1', 'uploaded']]) });
        render(<ProcurementPage crops={[]} />);
        expect(screen.getByTestId('bill-state-b1')).toHaveTextContent('शेतनोंदीत जमा ✓');
        expect(screen.getByTestId('bill-photo-b1')).toHaveTextContent('पाठवला');
    });

    it('a rejected line → needs the farmer; a failed photo says so', () => {
        h.evidence = evidence({
            rows: [{ description: 'b1:l1', status: 'REJECTED_USER_REVIEW', retryCount: 0 }],
            server: [{ description: 'b1:l2' }],
            photos: new Map([['att-1', 'failed']]),
        });
        render(<ProcurementPage crops={[]} />);
        expect(screen.getByTestId('bill-state-b1')).toHaveTextContent('मदत कराल का?');
        expect(screen.getByTestId('bill-photo-b1')).toHaveTextContent('पाठवता आला नाही');
    });
});

describe('वही — each entry says where it stands', () => {
    const entry = (id: string) => ({
        id, type: 'Expense', category: 'Input', effectiveAmount: 500, dateTime: '2026-10-20T10:00:00Z',
        sourceType: 'Procurement', sourceId: `${id}-src`, reviewStatus: 'OK', trustStatus: 'Unverified', plotId: 'p1',
    });

    it('queued → on this phone; server copy → on the server; no queue and no copy → on this phone', () => {
        h.events = [entry('e-queued'), entry('e-server'), entry('e-nowhere')];
        h.evidence = evidence({ rows: [{ id: 'e-queued', status: 'SENDING', retryCount: 0 }], server: [{ id: 'e-server' }] });
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('ledger-state-e-queued')).toHaveTextContent('पाठवणे बाकी');
        expect(screen.getByTestId('ledger-state-e-server')).toHaveTextContent('शेतनोंदीत जमा ✓');
        expect(screen.getByTestId('ledger-state-e-nowhere')).toHaveTextContent('पाठवणे बाकी');
    });

    it('no evidence → no claim on any entry', () => {
        h.events = [entry('e1')];
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('ledger-row-e1')).toBeInTheDocument();
        expect(screen.queryByTestId('ledger-state-e1')).toBeNull();
    });
});
