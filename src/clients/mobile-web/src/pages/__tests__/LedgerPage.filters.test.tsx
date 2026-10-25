// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the वही keeps every real feature of the
 * English Ledger: the four filters still filter (सर्व · जमा · खर्च · मजुरी दिली = job-card payouts), the
 * totals are the selector's entries, an entry with no stated direction is listed but in neither total and
 * the page says so, सविस्तर still offers the correction sheet for a खर्च, a job-card payout still opens the
 * jobs page, an amount still opens the money drawer, and an empty वही says so.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS } from './financeFixtures';

const h = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: { getEffectiveMoneyEvents: () => h.events },
}));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { applyAdjustment: vi.fn() } }));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen, filters }: { isOpen: boolean; filters: unknown }) =>
        isOpen ? <div data-testid="money-lens">{JSON.stringify(filters)}</div> : null,
}));
vi.mock('../../features/export', () => ({
    useExportReport: () => ({ exportReport: vi.fn(async () => true), isExporting: false, error: null }),
}));

import LedgerPage from '../LedgerPage';

const listedIds = () => screen.queryAllByTestId(/^ledger-row-/).map(el => el.getAttribute('data-testid')?.replace('ledger-row-', ''));

beforeEach(() => { h.events = EVENTS; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the वही filters still filter', () => {
    it('सर्व lists every entry, newest day first', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('ledger-filter-All')).toHaveAttribute('aria-pressed', 'true');
        expect(listedIds()).toEqual(['e1', 'e2', 'e5', 'e3', 'e4']);
        expect(screen.getByTestId('ledger-day-2026-10-20')).toHaveTextContent('3 नोंदी');
        expect(screen.getByTestId('ledger-day-2026-10-19')).toHaveTextContent('1 नोंद');
    });

    it('जमा shows only income', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-filter-Income'));
        expect(listedIds()).toEqual(['e1']);
    });

    it('खर्च shows only spending — not the entry with no stated direction', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-filter-Expense'));
        expect(listedIds()).toEqual(['e2', 'e5', 'e3']);
    });

    it('मजुरी दिली shows only job-card payouts, and "काम पाहा" opens the jobs', () => {
        const onNavigate = vi.fn();
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={onNavigate} />);
        fireEvent.click(screen.getByTestId('ledger-filter-LabourPayouts'));
        expect(listedIds()).toEqual(['e3']);
        fireEvent.click(screen.getByTestId('ledger-job-e3'));
        expect(onNavigate).toHaveBeenCalledWith('jobs');
    });

    it('a filter with nothing in it says so; back to सर्व brings everything back', () => {
        h.events = EVENTS.filter(e => e.type !== 'Income');
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-filter-Income'));
        expect(listedIds()).toEqual([]);
        expect(screen.getByTestId('ledger-empty')).toHaveTextContent('या प्रकारची नोंद नाही.');
        fireEvent.click(screen.getByTestId('ledger-filter-All'));
        expect(listedIds()).toHaveLength(4);
    });
});

describe('the वही totals and marks', () => {
    it('जमा and खर्च are the entries\' totals; an undirected entry is in neither, and the page says so', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('ledger-in')).toHaveTextContent('₹ 50,000');
        expect(screen.getByTestId('ledger-out')).toHaveTextContent('₹ 35,250');
        expect(screen.getByTestId('ledger-no-direction')).toHaveTextContent('1 नोंद — जमा की खर्च ते नोंदलेलं नाही');
        expect(screen.getByTestId('ledger-row-e4')).toHaveTextContent('जमा की खर्च — नोंद नाही');
    });

    it('each entry says where it stands, and a खर्च not on a plot says so', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('ledger-row-e2')).toHaveTextContent('नोंदवलेले');
        expect(screen.getByTestId('ledger-row-e2')).toHaveTextContent('प्लॉटवर वाटलेला नाही');
        expect(screen.getByTestId('ledger-row-e5')).toHaveTextContent('तपासायचे');
        expect(screen.getByTestId('ledger-row-e3')).not.toHaveTextContent('प्लॉटवर वाटलेला नाही');
        expect(screen.getByTestId('ledger-row-e1')).not.toHaveTextContent('प्लॉटवर वाटलेला नाही');
    });

    it('an amount opens the money drawer on that entry\'s source', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: '₹ 1,250' }));
        expect(screen.getByTestId('money-lens')).toHaveTextContent('"sourceId":"src-e2"');
    });
});

describe('थोडक्यात / सविस्तर', () => {
    it('सविस्तर shows the source and note, and "दुरुस्त करा" for a खर्च only', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        expect(screen.queryByTestId('ledger-fix-e2')).toBeNull();
        fireEvent.click(screen.getByTestId('ledger-view-full'));
        expect(screen.getByTestId('ledger-detail-e2')).toHaveTextContent('बोलून सांगितलेली · युरिया');
        expect(screen.getByTestId('ledger-detail-e3')).toHaveTextContent('तपशील नाही');
        expect(screen.getByTestId('ledger-fix-e2')).toBeInTheDocument();
        expect(screen.queryByTestId('ledger-fix-e1')).toBeNull();
        expect(screen.queryByTestId('ledger-fix-e4')).toBeNull();
    });

    it('"दुरुस्त करा" opens the correction sheet for that entry\'s current amount', () => {
        render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('ledger-view-full'));
        fireEvent.click(screen.getByTestId('ledger-fix-e5'));
        expect(screen.getByText('रक्कम दुरुस्त करा')).toBeInTheDocument();
        expect(screen.getByText('आधीची रक्कम').parentElement).toHaveTextContent('₹30,000.00');
    });
});

it('an empty वही says so, with no report to make', () => {
    h.events = [];
    render(<LedgerPage currentRoute="finance-ledger" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('ledger-empty')).toHaveTextContent('वही रिकामी आहे');
    expect(screen.queryByTestId('ledger-report')).toBeNull();
});
