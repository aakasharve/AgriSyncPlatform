// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — खरेदी on the approved look, over the real bills.
 *
 * What must hold (founder: "make what was there available, cleaner"):
 *   - no English left on the page (the farm's own names in this fixture are Marathi, so ANY Latin letter in
 *     the text, a placeholder or an aria-label is a leftover);
 *   - the three totals follow the pick (they used to be the whole farm's whatever was picked), and a total
 *     with no bill behind it says "नोंद नाही", never ₹ 0;
 *   - a plot shows its own bills + its crop's shared bills + the farm-wide bills — including a plot bill
 *     saved without a `cropId` (the receipt sheet leaves it empty unless the photo suggested a crop);
 *   - the receipt sheet still opens; a bill opens that day's money (its plot's, when it has one); search works in Marathi;
 *   - the Marathi empty state; and a button whose handler is absent is not drawn (P5).
 *
 * The bill store, the money drawer and the receipt sheet's background helpers are mocked; the sheet itself is
 * real, so "it opens, in Marathi" is the real sheet. `fake-indexeddb/auto` first, per the precedent in
 * HarvestIncomePage.test.tsx: the sheet's imports reach Dexie at load time.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ProcurementExpense } from '../../types';

const bills: { current: ProcurementExpense[] } = { current: [] };
vi.mock('../../services/procurementRepository', () => ({
    procurementRepository: {
        getExpenses: () => bills.current,
        saveExpense: vi.fn(),
        getExpenseSummary: () => { throw new Error('the totals must follow the pick, not the whole-farm summary'); },
    },
}));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen, filters }: { isOpen: boolean; filters: unknown }) =>
        isOpen ? <div data-testid="money-lens">{JSON.stringify(filters)}</div> : null,
}));
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { createMoneyEventFromSource: vi.fn() } }));

import ProcurementPage from '../ProcurementPage';

const plot = (id: string, name: string) => ({ id, name }) as unknown as CropProfile['plots'][number];
const CROPS = [
    { id: 'c1', name: 'द्राक्ष', plots: [plot('p1', 'थॉम्पसन'), plot('p2', 'सोनाका')] },
    { id: 'c2', name: 'ऊस', plots: [plot('p3', 'ऊस १')] },
] as unknown as CropProfile[];

const bill = (id: string, scope: ProcurementExpense['scope'], amount: number, extra: Partial<ProcurementExpense> = {}): ProcurementExpense => ({
    id, scope, grandTotal: amount, subtotal: amount, date: '2026-10-20', createdAt: '2026-10-20T10:00:00.000Z',
    vendorName: `दुकान ${id.slice(1)}`, lineItems: [{ id: `${id}-1`, name: `वस्तू ${id.slice(1)}`, totalAmount: amount, category: 'FERTILIZER' }],
    paymentStatus: 'PAID', aiExtracted: true, userVerified: true, ...extra,
});
const FIXTURE: ProcurementExpense[] = [
    bill('b1', 'PLOT', 1000, { plotId: 'p1' }), // no cropId — its crop is the one that holds p1
    bill('b2', 'PLOT', 2000, { plotId: 'p2', cropId: 'c1' }),
    bill('b3', 'CROP', 4000, { cropId: 'c1' }),
    bill('b4', 'CROP', 8000, { cropId: 'c2' }),
    bill('b5', 'FARM', 16000, { vendorName: 'महावितरण', paymentStatus: 'CREDIT', linkedLogIds: ['log-1'] }),
    bill('b6', 'PLOT', 32000, { plotId: 'p3' }),
];

/** Every Latin letter a farmer could read: text, placeholders, labels, alt text. */
function latinLeftovers(): string[] {
    const found: string[] = [...((document.body.textContent ?? '').match(/[A-Za-z]+/g) ?? [])];
    document.body.querySelectorAll('[placeholder],[aria-label],[alt],[title]').forEach(el => {
        ['placeholder', 'aria-label', 'alt', 'title'].forEach(a => {
            const v = el.getAttribute(a);
            if (v && /[A-Za-z]/.test(v)) found.push(`${a}=${v}`);
        });
    });
    return found;
}

const totalText = (id: 'plot' | 'crop' | 'farm') => screen.getByTestId(`buy-total-${id}`).textContent ?? '';
const listedIds = () => screen.queryAllByTestId(/^bill-b\d$/).map(el => el.getAttribute('data-testid'));

beforeEach(() => { bills.current = FIXTURE; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('खरेदी — words', () => {
    it('leaves no English on the page, the receipt sheet included', () => {
        render(<ProcurementPage crops={CROPS} onBack={vi.fn()} onTell={vi.fn()} onGo={vi.fn()} />);
        fireEvent.click(screen.getByTestId('buy-crop-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-p1'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('खरेदी');
        expect(latinLeftovers()).toEqual([]);

        fireEvent.click(screen.getByTestId('scan-receipt-btn'));
        expect(screen.getByTestId('receipt-capture-sheet')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });

    it('says where each bill goes, in the farmer\'s words', () => {
        render(<ProcurementPage crops={CROPS} />);
        expect(screen.getByTestId('bill-where-b1')).toHaveTextContent('थॉम्पसन · प्लॉटवर');
        expect(screen.getByTestId('bill-where-b3')).toHaveTextContent('सर्व द्राक्ष · पिकासाठी सामायिक');
        expect(screen.getByTestId('bill-where-b5')).toHaveTextContent('सर्व शेतासाठी');
        expect(screen.getByTestId('bill-b5')).toHaveTextContent('उधार');
        expect(screen.getByTestId('bill-b5')).toHaveTextContent('नोंदीशी जोडलेलं');
    });
});

describe('खरेदी — the pick drives the list and the three totals', () => {
    it('सर्व: every bill, and the totals of the whole farm', () => {
        render(<ProcurementPage crops={CROPS} />);
        expect(listedIds()).toHaveLength(6);
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सगळं शेत');
        expect(totalText('plot')).toContain('₹ 35,000');
        expect(totalText('plot')).toContain('3 प्लॉटचा हिशोब');
        expect(totalText('crop')).toContain('₹ 12,000');
        expect(totalText('farm')).toContain('₹ 16,000');
    });

    it('one crop: its plots\' bills (even one saved without a crop) + its shared bills + farm-wide', () => {
        render(<ProcurementPage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('buy-crop-c1'));
        expect(listedIds().sort()).toEqual(['bill-b1', 'bill-b2', 'bill-b3', 'bill-b5']);
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सर्व द्राक्ष');
        expect(totalText('plot')).toContain('₹ 3,000');
        expect(totalText('crop')).toContain('₹ 4,000');
        expect(totalText('farm')).toContain('₹ 16,000');
    });

    it('one plot: its own bills + its crop\'s shared bills + farm-wide — not the next plot\'s', () => {
        render(<ProcurementPage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('buy-crop-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-p1'));
        expect(listedIds().sort()).toEqual(['bill-b1', 'bill-b3', 'bill-b5']);
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('थॉम्पसन (द्राक्ष)');
        expect(totalText('plot')).toContain('₹ 1,000');
        expect(totalText('plot')).toContain('थॉम्पसन');
        expect(totalText('crop')).toContain('₹ 4,000');
    });

    it('picking another crop starts its plots at "सर्व" and moves the totals with it', () => {
        render(<ProcurementPage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('buy-crop-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-p1'));
        fireEvent.click(screen.getByTestId('buy-crop-c2'));
        expect(screen.getByTestId('buy-plot-all')).toHaveAttribute('aria-pressed', 'true');
        expect(totalText('plot')).toContain('₹ 32,000');
        expect(totalText('crop')).toContain('₹ 8,000');
    });

    it('a total with no bill behind it says "नोंद नाही", never ₹ 0', () => {
        bills.current = [bill('b1', 'PLOT', 1000, { plotId: 'p1' })];
        render(<ProcurementPage crops={CROPS} />);
        expect(screen.getByTestId('buy-total-crop-none')).toHaveTextContent('नोंद नाही');
        expect(screen.getByTestId('buy-total-farm-none')).toHaveTextContent('नोंद नाही');
        expect(document.body.textContent).not.toMatch(/₹\s?0(?![\d,])/);
    });
});

describe('खरेदी — every real part still works', () => {
    it('"बिलाचा फोटो काढा" opens the receipt sheet, and it closes again', () => {
        render(<ProcurementPage crops={CROPS} />);
        expect(screen.queryByTestId('receipt-capture-sheet')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('scan-receipt-btn'));
        const sheet = screen.getByTestId('receipt-capture-sheet');
        expect(sheet).toHaveTextContent('नवं बिल');
        expect(within(sheet).getByTestId('attachment-input')).toBeInTheDocument();
        fireEvent.click(within(sheet).getByLabelText('बंद करा'));
        expect(screen.queryByTestId('receipt-capture-sheet')).not.toBeInTheDocument();
    });

    it('tapping a bill opens that day\'s money for the bill\'s plot (no source or crop filter: neither survives a sync)', () => {
        render(<ProcurementPage crops={CROPS} />);
        expect(screen.queryByTestId('money-lens')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('bill-b1'));
        const filters = JSON.parse(screen.getByTestId('money-lens').textContent ?? '{}');
        // No source filter: entries read back from the server are all `Manual`, so a `Procurement` filter
        // emptied the drawer (I8 review B002). The day and the place are what can be matched.
        expect(filters).toEqual({ fromDate: '2026-10-20', toDate: '2026-10-20', plotId: 'p1' });
    });

    it('searches by shop or item, in Marathi, and says so plainly when nothing matches', () => {
        render(<ProcurementPage crops={CROPS} />);
        const search = screen.getByTestId('buy-search');
        expect(search).toHaveAttribute('placeholder', 'बिल शोधा — दुकान किंवा वस्तू');
        fireEvent.change(search, { target: { value: 'महावितरण' } });
        expect(listedIds()).toEqual(['bill-b5']);
        fireEvent.change(search, { target: { value: 'वस्तू 3' } });
        expect(listedIds()).toEqual(['bill-b3']);
        fireEvent.change(search, { target: { value: 'कीटकनाशक' } });
        expect(listedIds()).toEqual([]);
        expect(screen.getByTestId('buy-no-match')).toHaveTextContent('असं बिल सापडलं नाही');
    });

    it('shows the Marathi empty state when there are no bills', () => {
        bills.current = [];
        render(<ProcurementPage crops={CROPS} onTell={vi.fn()} />);
        expect(screen.getByTestId('buy-empty')).toHaveTextContent('इथे अजून काही खरेदी नाही. बिलाचा फोटो काढा किंवा बोलून सांगा.');
        for (const id of ['plot', 'crop', 'farm'] as const) expect(screen.getByTestId(`buy-total-${id}-none`)).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('₹');
    });
});

describe('खरेदी — no dead buttons (P5)', () => {
    it('draws no मागे, no बोलून सांगा / हाताने लिहा and no पैसे व हिशोब when the route gives no handler', () => {
        bills.current = [];
        render(<ProcurementPage crops={CROPS} />);
        for (const id of ['page-back', 'buy-tell', 'buy-write', 'buy-tell-note', 'buy-finance']) {
            expect(screen.queryByTestId(id)).not.toBeInTheDocument();
        }
        // …and the empty state does not point at a button that is not there.
        expect(screen.getByTestId('buy-empty')).toHaveTextContent('इथे अजून काही खरेदी नाही. बिलाचा फोटो काढा.');
        expect(screen.getByTestId('scan-receipt-btn')).toBeInTheDocument();
    });

    it('wires each one to its handler when given', () => {
        const onBack = vi.fn(); const onTell = vi.fn(); const onGo = vi.fn();
        render(<ProcurementPage crops={CROPS} onBack={onBack} onTell={onTell} onGo={onGo} />);
        fireEvent.click(screen.getByTestId('page-back'));
        fireEvent.click(screen.getByTestId('buy-tell'));
        fireEvent.click(screen.getByTestId('buy-write'));
        fireEvent.click(screen.getByTestId('buy-finance'));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onTell).toHaveBeenCalledTimes(2);
        expect(onGo).toHaveBeenCalledWith('finance-manager');
    });
});
