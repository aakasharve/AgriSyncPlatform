// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the अहवाल keeps the real Reports page: four
 * periods, नफा/तोटा with its share of जमा, जमा, खर्च, the split by kind and the loss warning, and
 * सेवेचा पुरावा for the same three roles. A period with no entry says so and shows no ₹ figure (P4); the
 * period's days are the farm's calendar days (they slipped one day back in India before).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { periodFilters } from '../../features/finance/moneyLabels';
import { EVENTS, ev } from './financeFixtures';

const h = vi.hoisted(() => ({ events: [] as unknown[], asked: [] as unknown[], role: 'PrimaryOwner' as string }));

vi.mock('../../features/finance/financeSelectors', () => ({
    financeSelectors: { getEffectiveMoneyEvents: (filters: unknown) => { h.asked.push(filters); return h.events; } },
}));
vi.mock('../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarm: { role: h.role } }) }));

import ReportsPage from '../ReportsPage';

beforeEach(() => { h.events = EVENTS; h.asked = []; h.role = 'PrimaryOwner'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the period is the farm\'s calendar days', () => {
    it('हा महिना starts on the 1st — not the last day of the month before', () => {
        expect(periodFilters('THIS_MONTH', '2026-10-01')).toEqual({ fromDate: '2026-10-01' });
    });

    it('मागचा महिना runs to its own last day, across a year and a short February', () => {
        expect(periodFilters('LAST_MONTH', '2026-01-15')).toEqual({ fromDate: '2025-12-01', toDate: '2025-12-31' });
        expect(periodFilters('LAST_MONTH', '2026-03-31')).toEqual({ fromDate: '2026-02-01', toDate: '2026-02-28' });
        expect(periodFilters('LAST_MONTH', '2028-03-01')).toEqual({ fromDate: '2028-02-01', toDate: '2028-02-29' });
    });

    it('हे वर्ष from 1 January; सगळं with no bound', () => {
        expect(periodFilters('THIS_YEAR', '2026-10-25')).toEqual({ fromDate: '2026-01-01' });
        expect(periodFilters('ALL_TIME', '2026-10-25')).toEqual({});
    });

    it('the page asks the selector for this month first, and for each period picked', () => {
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(h.asked[0]).toEqual(periodFilters('THIS_MONTH', getDateKey()));
        fireEvent.click(screen.getByTestId('report-period-ALL_TIME'));
        expect(h.asked[h.asked.length - 1]).toEqual({});
        expect(screen.getByTestId('report-profit')).toHaveTextContent('सगळं');
    });
});

describe('the figures are the period\'s real entries', () => {
    it('नफा, its share of जमा, जमा and खर्च; an undirected entry is in neither and is said', () => {
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('report-profit')).toHaveTextContent('नफा · हा महिना');
        expect(screen.getByTestId('report-profit')).toHaveTextContent('+ ₹ 14,750');
        expect(screen.getByTestId('report-margin')).toHaveTextContent('जमेच्या 29.5% हातात राहिले');
        expect(screen.getByTestId('report-income')).toHaveTextContent('₹ 50,000');
        expect(screen.getByTestId('report-spend')).toHaveTextContent('₹ 35,250');
        expect(screen.getByTestId('report-no-direction')).toHaveTextContent('1 नोंद');
        expect(screen.queryByTestId('report-loss-tip')).toBeNull();
    });

    it('where the money went, biggest first, each with its share of खर्च', () => {
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        const rows = screen.getAllByTestId(/^report-cat-/).map(el => el.getAttribute('data-testid'));
        expect(rows).toEqual(['report-cat-Fuel', 'report-cat-Labour', 'report-cat-Input']);
        expect(screen.getByTestId('report-cat-Fuel')).toHaveTextContent('इंधन₹ 30,000 (85%)');
    });

    it('a loss says तोटा and names the period\'s real biggest cost', () => {
        h.events = [ev('i', 'Income', 'Other', 1000), ev('x', 'Expense', 'Machinery', 5000), ev('y', 'Expense', 'Labour', 2000)];
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('report-profit')).toHaveTextContent('तोटा · हा महिना');
        expect(screen.getByTestId('report-profit')).toHaveTextContent('− ₹ 6,000');
        expect(screen.getByTestId('report-loss-tip')).toHaveTextContent('सर्वात मोठा खर्च: यंत्र — ₹ 5,000.');
    });

    it('no जमा: no made-up 0% share', () => {
        h.events = [ev('x', 'Expense', 'Fuel', 500)];
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.queryByTestId('report-margin')).toBeNull();
    });

    // lane HONESTY-2 (H2) — harvest income is not entered anywhere yet, so a month of spending alone is not a loss.
    describe('H2 — a period with no income recorded is not a loss', () => {
        it('prints the खर्च and "उत्पन्न अजून नोंदवलेलं नाही", and neither नफा nor तोटा', () => {
            h.events = [ev('x', 'Expense', 'Fuel', 500), ev('y', 'Expense', 'Labour', 1500)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            const card = screen.getByTestId('report-profit');
            expect(card).toHaveTextContent('खर्च · हा महिना');
            expect(screen.getByTestId('report-spend')).toHaveTextContent('₹ 2,000');
            expect(screen.getByTestId('report-no-income')).toHaveTextContent('उत्पन्न अजून नोंदवलेलं नाही');
            expect(card.textContent).not.toContain('तोटा');
            expect(card.textContent).not.toContain('नफा');
            expect(card.textContent).not.toContain('−');
            expect(card.textContent).not.toContain('%');
        });

        it('draws no ₹ 0 जमा tile, no share of जमा, no loss warning and no partial note', () => {
            h.events = [ev('x', 'Expense', 'Machinery', 5000)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.queryByTestId('report-income')).toBeNull();
            expect(screen.queryByTestId('report-margin')).toBeNull();
            expect(screen.queryByTestId('report-loss-tip')).toBeNull();
            expect(screen.queryByTestId('report-partial-note')).toBeNull();
            expect(document.body.textContent).not.toContain('तोटा');
            expect(document.body.textContent).not.toContain('नफा');
        });

        it('the खर्च split below it is unchanged', () => {
            h.events = [ev('x', 'Expense', 'Fuel', 500)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.getByTestId('report-cat-Fuel')).toHaveTextContent('इंधन₹ 500 (100%)');
        });

        it('an income entry corrected to ₹ 0 counts as no income', () => {
            h.events = [ev('i', 'Income', 'Other', 0), ev('x', 'Expense', 'Fuel', 500)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.getByTestId('report-no-income')).toBeInTheDocument();
            expect(screen.getByTestId('report-profit').textContent).not.toContain('तोटा');
        });

        it('only undirected entries: no ₹ figure is made up for the headline', () => {
            h.events = [ev('u', 'Unknown', 'Other', 700)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.getByTestId('report-spend')).toHaveTextContent('—');
            expect(screen.getByTestId('report-spend').textContent).not.toContain('₹');
            expect(screen.getByTestId('report-no-income')).toBeInTheDocument();
            expect(screen.getByTestId('report-no-direction')).toHaveTextContent('1 नोंद');
        });

        it('with income recorded, the figure says it is partial and based on what was recorded', () => {
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.getByTestId('report-partial-note')).toHaveTextContent('अपूर्ण — फक्त नोंदवलेल्या रकमांवर आधारित');
            expect(screen.queryByTestId('report-no-income')).toBeNull();
        });

        it('with income recorded and a loss, तोटा and its warning stay, with the partial note', () => {
            h.events = [ev('i', 'Income', 'Other', 1000), ev('x', 'Expense', 'Machinery', 5000)];
            render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
            expect(screen.getByTestId('report-profit')).toHaveTextContent('तोटा · हा महिना');
            expect(screen.getByTestId('report-partial-note')).toBeInTheDocument();
            expect(screen.getByTestId('report-loss-tip')).toBeInTheDocument();
        });
    });

    // I8 review B004 — the only fuel bill was marked duplicate (corrected to ₹ 0): no "इंधन ₹ 0 (NaN%)".
    it('a category that spent nothing gets no row, and nothing reads NaN', () => {
        h.events = [ev('x', 'Expense', 'Fuel', 0), ev('y', 'Expense', 'Labour', 2000)];
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.queryByTestId('report-cat-Fuel')).toBeNull();
        expect(screen.getByTestId('report-cat-Labour')).toHaveTextContent('(100%)');
        expect(document.body.textContent).not.toContain('NaN');
    });

    it('a period with no entry says so and shows no ₹ figure', () => {
        h.events = [];
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('report-empty')).toHaveTextContent('हा महिना — एकही नोंद नाही.');
        expect(document.body.textContent).not.toContain('₹');
        expect(screen.queryByTestId('report-margin')).toBeNull();
    });

    it('"वहीत सगळ्या नोंदी पाहा" opens the वही (it was a button that did nothing)', () => {
        const onNavigate = vi.fn();
        render(<ReportsPage currentRoute="finance-reports" onNavigate={onNavigate} />);
        fireEvent.click(screen.getByTestId('report-open-ledger'));
        expect(onNavigate).toHaveBeenCalledWith('finance-ledger');
    });
});

describe('सेवेचा पुरावा is for the same three roles as before', () => {
    for (const role of ['PrimaryOwner', 'Agronomist', 'Consultant']) {
        it(`${role} sees it, and it opens the service proof`, () => {
            h.role = role;
            const onNavigate = vi.fn();
            render(<ReportsPage currentRoute="finance-reports" onNavigate={onNavigate} />);
            fireEvent.click(screen.getByTestId('report-service-proof'));
            expect(onNavigate).toHaveBeenCalledWith('service-proof');
        });
    }

    it('anyone else does not', () => {
        h.role = 'Worker';
        render(<ReportsPage currentRoute="finance-reports" onNavigate={vi.fn()} />);
        expect(screen.queryByTestId('report-service-proof')).toBeNull();
    });
});
