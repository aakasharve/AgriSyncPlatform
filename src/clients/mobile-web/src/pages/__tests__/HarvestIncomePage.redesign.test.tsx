// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — उत्पन्न on the approved look, over the real records.
 *
 * What must hold:
 *   - no English left on the page or in the "इतर उत्पन्न जोडा" sheet;
 *   - no sale figure (nothing this page can read records a sale) and no ₹ 0 for what was never recorded (P4);
 *   - other income still saves through the REAL service: `addOtherIncomeEntry` stores it and sends its money
 *     entry, and the page lists it. Only the money pipeline below the service is a spy;
 *   - the harvest notice is still there, and there is still no control that could start a sale;
 *   - a button whose handler the route did not give is not drawn (P5).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile } from '../../types';
import { harvestAvailabilityTranslations } from '../../i18n/harvestAvailabilityTranslations';

vi.mock('../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (key: string) => key }),
}));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../features/finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...args: unknown[]) => createMoneyEventFromSource(...args) },
}));

import HarvestIncomePage from '../HarvestIncomePage';
import { readOtherIncomeRaw } from '../../infrastructure/storage/HarvestLegacyStore';

const CROPS = [{ id: 'c1', name: 'द्राक्ष', plots: [] }] as unknown as CropProfile[];

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

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe('उत्पन्न — words and honest figures', () => {
    it('leaves no English on the page or in the add sheet', () => {
        render(<HarvestIncomePage crops={CROPS} onBack={vi.fn()} onGo={vi.fn()} />);
        expect(screen.getByTestId('page-title')).toHaveTextContent('उत्पन्न');
        expect(latinLeftovers()).toEqual([]);
        fireEvent.click(screen.getByTestId('income-kind-scrap'));
        expect(screen.getByTestId('other-income-sheet')).toBeInTheDocument();
        expect(latinLeftovers()).toEqual([]);
    });

    it('shows no sale figure and no ₹ 0 when nothing is recorded — it says so in words', () => {
        render(<HarvestIncomePage crops={CROPS} />);
        expect(screen.getByTestId('income-sales')).toHaveTextContent('अजून इथे नोंद होत नाही');
        expect(screen.getByTestId('income-other-total')).toHaveTextContent('अजून नोंद नाही');
        expect(screen.getByTestId('income-other-empty')).toHaveTextContent('अजून काही इतर उत्पन्न नोंदवलेलं नाही.');
        expect(document.body.textContent).not.toContain('₹');
    });

    it('keeps the harvest notice, and offers nothing that could start a sale', () => {
        render(<HarvestIncomePage crops={CROPS} onBack={vi.fn()} onGo={vi.fn()} />);
        const notice = screen.getByTestId('harvest-coming-soon');
        expect(notice).toHaveTextContent(harvestAvailabilityTranslations.mr.harvestUnavailableTitle);
        expect(notice).toHaveTextContent(harvestAvailabilityTranslations.mr.harvestUnavailableBody);
        expect(screen.queryByText(/विक्री बोलून/)).not.toBeInTheDocument();
    });
});

describe('उत्पन्न — other income saves through the real service', () => {
    it('a kind tile opens the sheet with its word written in; saving stores it, sends its money entry, and lists it', () => {
        render(<HarvestIncomePage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('income-kind-subsidy'));
        const sheet = screen.getByTestId('other-income-sheet');
        expect(within(sheet).getByTestId('other-income-what')).toHaveValue('अनुदान');
        // amount and what are both needed — as before
        expect(within(sheet).getByTestId('other-income-save')).toBeDisabled();
        fireEvent.change(within(sheet).getByTestId('other-income-amount'), { target: { value: '18000' } });
        fireEvent.click(within(sheet).getByTestId('other-income-save'));

        const stored = JSON.parse(readOtherIncomeRaw() ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ amount: 18000, description: 'अनुदान', source: 'OTHER' });
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(1);
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({
            type: 'Income', eventType: 'Income', amount: 18000, sourceId: stored[0].id,
        }));

        expect(screen.queryByTestId('other-income-sheet')).not.toBeInTheDocument();
        expect(screen.getByTestId(`other-income-${stored[0].id}`)).toHaveTextContent('अनुदान');
        expect(screen.getByTestId(`other-income-${stored[0].id}`)).toHaveTextContent('₹ 18,000');
        expect(screen.getByTestId('income-other-total')).toHaveTextContent('₹ 18,000');
        // still no sale figure once other income exists
        expect(screen.getByTestId('income-sales')).not.toHaveTextContent('₹');
    });

    it('saves the source and crop the farmer picked', () => {
        render(<HarvestIncomePage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('income-kind-other'));
        fireEvent.change(screen.getByTestId('other-income-what'), { target: { value: 'रोपं विकली' } });
        fireEvent.click(screen.getByTestId('other-income-source-PLANT_SALE'));
        fireEvent.change(screen.getByTestId('other-income-crop'), { target: { value: 'c1' } });
        fireEvent.change(screen.getByTestId('other-income-amount'), { target: { value: '2400' } });
        fireEvent.click(screen.getByTestId('other-income-save'));

        const [entry] = JSON.parse(readOtherIncomeRaw() ?? '[]');
        expect(entry).toMatchObject({ amount: 2400, description: 'रोपं विकली', source: 'PLANT_SALE', cropId: 'c1' });
        expect(screen.getByTestId(`other-income-${entry.id}`)).toHaveTextContent('रोपांची विक्री');
        expect(screen.getByTestId(`other-income-${entry.id}`)).toHaveTextContent('द्राक्ष');
    });

    it('closing the sheet saves nothing', () => {
        render(<HarvestIncomePage crops={CROPS} />);
        fireEvent.click(screen.getByTestId('income-kind-rent'));
        fireEvent.click(screen.getByLabelText('बंद करा'));
        expect(screen.queryByTestId('other-income-sheet')).not.toBeInTheDocument();
        expect(readOtherIncomeRaw()).toBeNull();
        expect(createMoneyEventFromSource).not.toHaveBeenCalled();
    });
});

describe('उत्पन्न — no dead buttons (P5)', () => {
    it('draws no मागे and no पैसे व हिशोब when the route gives no handler', () => {
        render(<HarvestIncomePage crops={CROPS} />);
        expect(screen.queryByTestId('page-back')).not.toBeInTheDocument();
        expect(screen.queryByTestId('income-finance')).not.toBeInTheDocument();
    });

    it('wires them when given', () => {
        const onBack = vi.fn(); const onGo = vi.fn();
        render(<HarvestIncomePage crops={CROPS} onBack={onBack} onGo={onGo} />);
        fireEvent.click(screen.getByTestId('page-back'));
        fireEvent.click(screen.getByTestId('income-finance'));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onGo).toHaveBeenCalledWith('finance-manager');
    });
});
