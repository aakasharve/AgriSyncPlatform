// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — पैसे व हिशोब on the approved look, over the real
 * stores. What must hold on all six pages (founder: "make what was there available, cleaner"):
 *   - no English left: the farm's own words in the fixtures are Marathi, so ANY Latin letter in the text, a
 *     placeholder, an aria-label or a tooltip is a leftover — the same for the sheets these pages open;
 *   - one title bar; "मागे" only when the router gives a way back, and the Marathi chip row of the six
 *     pages while it does not (no page is a dead end);
 *   - the home's piles and figures are the selectors' real numbers, and an empty farm says so;
 *   - this month's cost report says, in Marathi, when it could not be made (P5).
 *
 * The stores, the money drawer (its own test: `MoneyLensDrawer.marathi.test.tsx`) and the report download are mocked.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKETS, EVENTS, RATES, latinLeftovers } from './financeFixtures';

const h = vi.hoisted(() => ({
    events: [] as unknown[],
    buckets: [] as unknown[],
    rates: [] as unknown[],
    exportOk: true,
    role: 'PrimaryOwner' as string,
    platformAdmin: true,
}));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: {
        getEffectiveMoneyEvents: () => h.events,
        getPipelineBuckets: () => h.buckets,
        getTotalCost: () => (h.events as { type: string; effectiveAmount: number }[])
            .filter(e => e.type === 'Expense').reduce((s, e) => s + e.effectiveAmount, 0),
        getReviewInbox: () => (h.events as { reviewStatus: string }[]).filter(e => e.reviewStatus === 'NeedsReview'),
    },
}));
vi.mock('../../features/finance/financeService', () => ({
    financeService: {
        getPriceBook: () => h.rates,
    },
}));
vi.mock('../../features/finance/financeCommandService', () => ({
    financeCommandService: { createPriceBookItem: vi.fn(), applyAdjustment: vi.fn() },
}));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../features/export', () => ({
    useExportReport: () => ({ exportReport: async () => h.exportOk, isExporting: false, error: null }),
}));
vi.mock('../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarm: { role: h.role } }) }));
vi.mock('../../application/usecases/sync/AllocateGlobalExpenseCommand', () => ({ AllocateGlobalExpenseCommand: { enqueue: vi.fn() } }));
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
// lane F99 fix pass 1 (D-72): the price book's write controls are the platform admin's; both views are checked below.
vi.mock('../../core/session/usePlatformAdmin', () => ({ usePlatformAdmin: () => h.platformAdmin }));

import FinanceManagerHome from '../FinanceManagerHome';
import LedgerPage from '../LedgerPage';
import PriceBookPage from '../PriceBookPage';
import ReviewInboxPage from '../ReviewInboxPage';
import ReportsPage from '../ReportsPage';
import AllocationSelector from '../../features/finance/components/AllocationSelector';
import DuplicateWarning from '../../features/finance/components/DuplicateWarning';
import type { AppRoute, Plot } from '../../types';

type PageProps = { currentRoute: AppRoute; onNavigate: (r: AppRoute) => void; onBack?: () => void };
const PAGES: [string, AppRoute, React.FC<PageProps>, string][] = [
    ['home', 'finance-manager', FinanceManagerHome, 'पैसे व हिशोब'],
    ['ledger', 'finance-ledger', LedgerPage, 'वही'],
    ['price book', 'finance-price-book', PriceBookPage, 'दरपत्रक'],
    ['review inbox', 'finance-review-inbox', ReviewInboxPage, 'तपासायचे'],
    ['reports', 'finance-reports', ReportsPage, 'अहवाल'],
];

beforeEach(() => {
    h.events = EVENTS;
    h.buckets = BUCKETS;
    h.rates = RATES;
    h.exportOk = true;
    h.role = 'PrimaryOwner';
    h.platformAdmin = true;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('no English is left on the पैसे व हिशोब pages', () => {
    for (const [name, route, Page, title] of PAGES) {
        it(`${name}: Marathi title, with a way back`, () => {
            render(<Page currentRoute={route} onNavigate={vi.fn()} onBack={vi.fn()} />);
            expect(screen.getByTestId('page-title')).toHaveTextContent(title);
            expect(screen.getByTestId('page-back')).toHaveTextContent('मागे');
            expect(latinLeftovers()).toEqual([]);
        });

        it(`${name}: Marathi, with an empty farm`, () => {
            h.events = [];
            h.buckets = BUCKETS.map(b => ({ ...b, count: 0, total: 0 }));
            h.rates = [];
            render(<Page currentRoute={route} onNavigate={vi.fn()} />);
            expect(latinLeftovers()).toEqual([]);
        });
    }

    it('the ledger in सविस्तर, and the correction sheet it opens', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-view-full'));
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByTestId('ledger-fix-e2'));
        // The sheet names the kind of cost in Marathi too (it was handed the stored `Input`).
        expect(screen.getByText('रक्कम दुरुस्त करा').parentElement).toHaveTextContent('खत-औषध');
        expect(latinLeftovers()).toEqual([]);
    });

    it('the price book as a farmer reads it (not the platform admin): the read-only line is Marathi too', () => {
        h.platformAdmin = false;
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('price-read-only')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });

    it('the price book while a rate is being changed, and after one is written', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-change-pb1'));
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByTestId('price-save'));
        expect(screen.getByTestId('price-written')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });

    it('the allocation sheet, every way of splitting', () => {
        const plots = [
            { id: 'p1', name: 'थॉम्पसन', baseline: { totalArea: 2, unit: 'Acre' } },
            { id: 'p2', name: 'सोनाका', baseline: { totalArea: 20, unit: 'Guntha' } },
        ] as unknown as Plot[];
        render(<AllocationSelector costEntryId="c1" totalAmount={9000} plots={plots} onAllocate={vi.fn()} onCancel={vi.fn()} />);
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByText('क्षेत्रानुसार'));
        expect(screen.getByText('2 एकर')).toBeInTheDocument();
        expect(screen.getByText('20 गुंठे')).toBeInTheDocument();
        fireEvent.click(screen.getByText('आपल्या रकमा'));
        expect(screen.getByText(/बाकी$/)).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });

    it('the double-entry warning', () => {
        render(<DuplicateWarning onSaveAnyway={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('दुहेरी नोंद असू शकते')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });
});

describe('getting around: one title bar, never a dead end', () => {
    it('a page with no way back shows the six pages as Marathi chips, and they navigate', () => {
        const onNavigate = vi.fn();
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={onNavigate} />);
        expect(screen.queryByTestId('page-back')).toBeNull();
        expect(screen.getByTestId('finance-nav-finance-ledger')).toHaveAttribute('aria-current', 'page');
        fireEvent.click(screen.getByTestId('finance-nav-finance-price-book'));
        expect(onNavigate).toHaveBeenCalledWith('finance-price-book');
    });

    it('with a way back, the chip row is gone and "मागे" goes back', () => {
        const onBack = vi.fn();
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} onBack={onBack} />);
        expect(screen.queryByTestId('finance-nav')).toBeNull();
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('the home opens every page through its own rows, not the chip row', () => {
        const onNavigate = vi.fn();
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={onNavigate} />);
        expect(screen.queryByTestId('finance-nav')).toBeNull();
        const rows: [string, AppRoute][] = [
            ['fin-open-ledger', 'finance-ledger'], ['fin-open-prices', 'finance-price-book'], ['fin-open-review', 'finance-review-inbox'],
            ['fin-open-reports', 'finance-reports'],
        ];
        for (const [testId, route] of rows) {
            fireEvent.click(screen.getByTestId(testId));
            expect(onNavigate).toHaveBeenLastCalledWith(route);
        }
        // spec: pre-launch-repair L2a (R-7, D-18) — the two finance settings did nothing, so their row is gone.
        expect(screen.queryByTestId('fin-open-settings')).toBeNull();
        expect(document.body.textContent).not.toContain('हिशोबाची सेटिंग');
        expect(document.body.textContent).not.toContain('मोठ्या रकमेची मर्यादा');
    });
});

describe('the home shows the real piles and figures', () => {
    it('four piles from the selector; तपासायचे opens the review page, the others the वही', () => {
        const onNavigate = vi.fn();
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={onNavigate} />);
        expect(screen.getByTestId('fin-tile-Captured')).toHaveTextContent('नोंदवलेले5₹ 85,950');
        expect(screen.getByTestId('fin-tile-NeedsReview')).toHaveTextContent('तपासायचे1₹ 30,000पाहायचं बाकी');
        expect(screen.getByTestId('fin-tile-Approved')).toHaveTextContent('मंजुरी अजून उपलब्ध नाही');
        fireEvent.click(screen.getByTestId('fin-tile-NeedsReview'));
        expect(onNavigate).toHaveBeenLastCalledWith('finance-review-inbox');
        fireEvent.click(screen.getByTestId('fin-tile-Adjusted'));
        expect(onNavigate).toHaveBeenLastCalledWith('finance-ledger');
    });

    it('एकूण खर्च is the real total spent, तपासणी बाकी the waiting pile', () => {
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('fin-quick-spent')).toHaveTextContent('₹ 35,250');
        expect(screen.getByTestId('fin-quick-waiting')).toHaveTextContent('₹ 30,000');
    });

    it('a farm with no entry says so, and shows no figures', () => {
        h.events = [];
        h.buckets = BUCKETS.map(b => ({ ...b, count: 0, total: 0 }));
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('fin-home-empty')).toHaveTextContent('अजून एकही नोंद नाही');
        expect(screen.queryByTestId('fin-quick')).toBeNull();
        expect(screen.queryByTestId('fin-home-report')).toBeNull();
        // I8 review B003 — no pile tile prints a "0 / ₹ 0" nobody measured
        for (const key of ['Captured', 'NeedsReview', 'Approved', 'Adjusted']) {
            expect(screen.getByTestId(`fin-tile-${key}`).textContent).not.toMatch(/₹|\d/);
        }
    });

    it('the मंजूर pile never shows a figure: nothing can approve an entry yet (PENDING D-12)', () => {
        h.buckets = BUCKETS.map(b => (b.key === 'Approved' ? { ...b, count: 2, total: 5000 } : b));
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('fin-tile-Approved').textContent).not.toMatch(/₹|\d/);
        expect(screen.getByTestId('fin-tile-Approved-unavailable')).toBeInTheDocument();
    });
});

describe("this month's cost report", () => {
    it('says in Marathi when the report could not be made', async () => {
        h.exportOk = false;
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-report'));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('अहवाल काढता आला नाही'));
        expect(latinLeftovers()).toEqual([]);
    });

    it('says in Marathi when it was made', async () => {
        render(<FinanceManagerHome currentRoute="finance-manager" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('fin-home-report'));
        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('अहवाल तयार झाला'));
    });
});
