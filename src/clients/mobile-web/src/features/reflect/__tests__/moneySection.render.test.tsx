// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF)
 *
 * उत्पन्न आणि खर्च on the server's ledger, drawn in Marathi AND English: money this person may not see is "—" with
 * one line saying why and no door into the money pages (founder D-22); a total made from an incomplete set is
 * labelled partial, with why; a complete one says nothing more.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => {
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { CostSection, InHandCard } from '../overview/CostSection';
import { buildInHand, buildSeasonTotals, buildSpend, spendRange, type Ledger } from '../overview/moneyModel';
import { selectAll, toViewScope } from '../overview/reflectSelection';
import { reflectCopy } from '../reflectCopy';
import { CROPS, TODAY, TODAY_KEY } from './reflectFixtures';

const all = toViewScope(CROPS, selectAll(CROPS));
const range = spendRange('week', TODAY, TODAY);
const noSessions = () => [];
const ledger: Ledger = {
    entries: [
        { id: 'a', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense', category: 'Labour', amount: 2000 },
        { id: 'r', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Income', category: 'Other', amount: 5000 },
        { id: 'u', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Unknown', category: 'Other', amount: 777 },
    ],
    gaps: [{ plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense' }],
    complete: true,
};

const draw = (visible: boolean, onOpenFinance = vi.fn(), onOpenIncome = vi.fn()) => {
    render(<>
        <InHandCard figure={buildInHand(ledger, CROPS, all, visible)} onOpen={onOpenIncome} />
        <CostSection totals={buildSeasonTotals(ledger, CROPS, all, noSessions, visible)} spend={buildSpend(ledger, CROPS, all, range, visible)} range={range} onOpenFinance={onOpenFinance} />
    </>);
    return { onOpenFinance, onOpenIncome };
};

afterEach(cleanup);

describe.each(['mr', 'en'] as const)('the money section on the ledger (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const copy = () => reflectCopy(language);

    it('money he may not see: "—" everywhere, one line saying why, no chart, no door into the money pages', () => {
        const { onOpenFinance, onOpenIncome } = draw(false);
        for (const id of ['in-hand-amount', 'season-cost', 'season-income', 'season-net']) expect(screen.getByTestId(id)).toHaveTextContent('—');
        expect(screen.getByTestId('season-hidden')).toHaveTextContent(copy().moneyHidden);
        expect(screen.getByTestId('in-hand-hidden')).toHaveTextContent(copy().moneyHidden);
        expect(screen.queryByTestId('week-total')).toBeNull();
        expect(screen.queryByTestId('cost-mix')).toBeNull();
        expect(screen.queryByTestId('open-finance')).toBeNull();
        fireEvent.click(screen.getByTestId('overview-money'));
        expect(onOpenIncome).not.toHaveBeenCalled();
        expect(onOpenFinance).not.toHaveBeenCalled();
        const text = document.body.textContent ?? '';
        for (const amount of ['2,000', '5,000', '777']) expect(text).not.toContain(amount);
    });

    it('review B008: the in-hand card\'s label follows his language', () => {
        draw(true);
        expect(screen.getByTestId('in-hand-label')).toHaveTextContent(language === 'en' ? 'Income received · so far' : 'हातात आलेलं उत्पन्न · आतापर्यंत');
    });

    it('review B003: a ledger not yet read in full says so, in his language', () => {
        render(<CostSection totals={buildSeasonTotals({ ...ledger, gaps: [], complete: false }, CROPS, all, noSessions, true)}
            spend={buildSpend({ ...ledger, gaps: [], complete: false }, CROPS, all, range, true)} range={range} />);
        expect(screen.getByTestId('season-cost-partial')).toHaveTextContent(copy().partialTag);
        expect(screen.getByTestId('season-partial-unchecked')).toHaveTextContent(copy().partialUnchecked);
    });

    it('a partial set: the figures carry "अपूर्ण" / "partial", and why — each reason once', () => {
        draw(true);
        expect(screen.getByTestId('season-cost')).toHaveTextContent('₹ 2,000');
        expect(screen.getByTestId('season-cost-partial')).toHaveTextContent(copy().partialTag);
        expect(screen.getByTestId('week-total-partial')).toHaveTextContent(copy().partialTag);
        expect(screen.getByTestId('season-partial-notOnServer')).toHaveTextContent(copy().partialNotOnServer);
        expect(screen.getByTestId('season-partial-unknownDirection')).toHaveTextContent(copy().partialUnknownDirection);
        // the amount whose direction is unknown is in neither total
        expect(screen.getByTestId('season-income')).toHaveTextContent('₹ 5,000');
        expect(screen.getByTestId('season-net')).toHaveTextContent('₹ 3,000');
    });

    it('money told but not on the server yet, nothing in the ledger: "—", and it says why (never ₹ 0)', () => {
        const waiting: Ledger = { entries: [], gaps: [{ plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense' }], complete: true };
        render(<CostSection totals={buildSeasonTotals(waiting, CROPS, all, noSessions, true)} spend={buildSpend(waiting, CROPS, all, range, true)} range={range} />);
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(screen.queryByTestId('season-cost-partial')).toBeNull(); // no "partial" tag on a dash
        expect(screen.getByTestId('season-partial-notOnServer')).toHaveTextContent(copy().partialNotOnServer);
        expect(document.body.textContent).not.toContain('₹ 0');
    });
});
