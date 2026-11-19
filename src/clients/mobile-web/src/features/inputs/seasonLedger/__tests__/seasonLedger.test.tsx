// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C) - the owner's season ledger of inputs: what the server sent is shown, sorted
 * and filtered, and never changed. An amount he did not say reads "सांगितलं नाही" (never a number), a use with no day sorts last when sorting
 * by day (never a made-up 0), a total appears only where the server sent one, and an answer that cannot be read draws nothing.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => {
    const lang = { current: 'mr' as 'mr' | 'en' };
    (globalThis as unknown as { __ledgerLang: typeof lang }).__ledgerLang = lang;
    const ctx = () => ({ language: lang.current, setLanguage: () => undefined, t: (k: string) => k });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

const loadLedger = vi.fn();
const rebuildLedger = vi.fn();
vi.mock('../seasonLedgerClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../seasonLedgerClient')>();
    return { ...actual, loadLedger: (...a: unknown[]) => loadLedger(...a), rebuildLedger: (...a: unknown[]) => rebuildLedger(...a), downloadLedgerCsv: vi.fn() };
});

import SeasonInputLedger, { amountOf } from '../SeasonInputLedger';
import { arrange, parseLedger, type Ledger, type LedgerRow } from '../seasonLedgerClient';

const row = (over: Partial<LedgerRow>): LedgerRow => ({
    inputItemId: 'i-' + Math.random().toString(36).slice(2), dailyLogId: null, date: '2026-11-10', plotName: 'प्लॉट १', cropName: 'Grapes',
    dayOfSeason: 9, stageName: 'छाटणीनंतर', productSaid: 'Karate', libraryProductId: 'p-karate', ingredients: ['Lambda-cyhalothrin'], groupCodes: 'IRAC 3A',
    amount: 250, unit: 'ml', perQuantity: null, perUnit: null, amountCertainty: null, amountSpokenText: null, method: 'Spray', carrierWaterLitres: 600, derived: true, ...over,
});

const ledgerOf = (rows: LedgerRow[], over: Partial<Ledger> = {}): Ledger => ({
    from: '2026-01-01', to: '2026-11-19', rows,
    products: [{ product: 'Karate', libraryProductId: 'p-karate', uses: 2, lastUsed: '2026-11-12', total: 750, unit: 'ml', noTotalBecause: null },
        { product: 'कोणतंतरी औषध', libraryProductId: null, uses: 1, lastUsed: '2026-11-11', total: null, unit: null, noTotalBecause: 'some uses state no amount' }],
    ingredients: [{ ingredient: 'Lambda-cyhalothrin', key: 'lambdacyhalothrin', groupCode: 'IRAC 3A', uses: 2 }], notYetDerived: 0, ...over,
});

const open = async (ledger: Ledger | { kind: string }) => {
    loadLedger.mockResolvedValue('rows' in ledger ? { kind: 'ledger', ledger } : ledger);
    render(<SeasonInputLedger farmId="farm-1" />);
    fireEvent.click(screen.getByTestId('season-ledger-toggle'));
};

afterEach(() => { cleanup(); loadLedger.mockReset(); rebuildLedger.mockReset(); (globalThis as unknown as { __ledgerLang: { current: string } }).__ledgerLang.current = 'mr'; });

describe('season ledger: what is shown', () => {
    it('Closed_AsksNothing_UntilTheOwnerOpensIt', () => {
        render(<SeasonInputLedger farmId="farm-1" />);
        expect(loadLedger).not.toHaveBeenCalled();
    });

    it('Open_ShowsTheProductAmountInHisWordsTheDayTheStageAndTheIngredients', async () => {
        await open(ledgerOf([row({})]));
        const r = await screen.findByTestId('season-ledger-row');
        expect(within(r).getByTestId('season-ledger-product').textContent).toBe('Karate');
        expect(within(r).getByTestId('season-ledger-amount').textContent).toContain('250 ml');
        expect(within(r).getByTestId('season-ledger-amount').textContent).toContain('Spray');
        expect(within(r).getByTestId('season-ledger-when').textContent).toContain('दिवस 9');
        expect(within(r).getByTestId('season-ledger-when').textContent).toContain('छाटणीनंतर');
        expect(within(r).getByTestId('season-ledger-ingredients').textContent).toContain('Lambda-cyhalothrin (IRAC 3A)');
    });

    it('NoAmountSaid_SaysSo_AndNeverShowsANumber', async () => {
        await open(ledgerOf([row({ amount: null, unit: null })]));
        expect((await screen.findByTestId('season-ledger-amount')).textContent).toContain('सांगितलं नाही');
        expect(amountOf(row({ amount: null, unit: null, amountSpokenText: 'अंदाजे अर्धा लिटर' }), 'सांगितलं नाही', 'प्रति')).toBe('अंदाजे अर्धा लिटर');
    });

    it('PerWater_IsShownAsHeSaidIt', () => {
        expect(amountOf(row({ amount: 250, unit: 'ml', perQuantity: 200, perUnit: 'L' }), 'x', 'प्रति')).toBe('250 ml प्रति 200 L');
    });

    it('TotalsAreOnlyWhereTheServerSentOne_OtherwiseADash', async () => {
        await open(ledgerOf([row({})]));
        const totals = await screen.findAllByTestId('season-ledger-product-total');
        expect(totals[0].textContent).toContain('एकूण 750 ml');
        expect(totals[1].textContent).toContain('—');
        expect(totals[1].textContent).not.toMatch(/\d{2,}/);
    });

    it('NotYetDerived_OffersARebuild_ThenAsksAgain', async () => {
        rebuildLedger.mockResolvedValue(3);
        await open(ledgerOf([row({ derived: false })], { notYetDerived: 1 }));
        fireEvent.click(await screen.findByTestId('season-ledger-refresh'));
        await waitFor(() => expect(rebuildLedger).toHaveBeenCalledWith('farm-1'));
        await waitFor(() => expect(loadLedger).toHaveBeenCalledTimes(2));
    });

    it('English_ShowsEnglishWordsOnly', async () => {
        (globalThis as unknown as { __ledgerLang: { current: string } }).__ledgerLang.current = 'en';
        await open(ledgerOf([row({ amount: null, unit: null })]));
        expect((await screen.findByTestId('season-ledger-amount')).textContent).toContain('not said');
        expect(screen.getByTestId('season-ledger-when').textContent).toContain('Day 9');
    });
});

describe('season ledger: the other answers', () => {
    it.each([['refused', 'season-ledger-refused'], ['offline', 'season-ledger-offline'], ['failed', 'season-ledger-failed']])('%s_DrawsOnlyItsOwnLine', async (kind, id) => {
        await open({ kind });
        expect(await screen.findByTestId(id)).toBeTruthy();
        expect(screen.queryByTestId('season-ledger-rows')).toBeNull();
    });

    it('Empty_SaysNothingWasRecorded', async () => {
        await open(ledgerOf([]));
        expect(await screen.findByTestId('season-ledger-empty')).toBeTruthy();
    });
});

describe('season ledger: sort and filter never change a value', () => {
    const rows = [
        row({ inputItemId: 'a', date: '2026-11-01', productSaid: 'Zinc', dayOfSeason: null, stageName: null }),
        row({ inputItemId: 'b', date: '2026-11-05', productSaid: 'Karate', dayOfSeason: 4, stageName: 'फूट वाढ' }),
        row({ inputItemId: 'c', date: '2026-11-09', productSaid: 'Boron', dayOfSeason: 8, stageName: 'फूट वाढ' }),
    ];
    const ids = (list: LedgerRow[]) => list.map(r => r.inputItemId).join('');

    it('Date_NewestFirstByDefault_AndFlips', () => {
        expect(ids(arrange(rows, 'date', true, ''))).toBe('cba');
        expect(ids(arrange(rows, 'date', false, ''))).toBe('abc');
    });

    it('Day_PutsAUseWithNoDayLast_NeverAMadeUpZero', () => {
        expect(ids(arrange(rows, 'day', false, ''))).toBe('bca');
        expect(ids(arrange(rows, 'day', true, ''))).toBe('cba');
    });

    it('Product_SortsByName', () => {
        expect(ids(arrange(rows, 'product', false, ''))).toBe('cba');
    });

    it('Filter_MatchesProductPlotStageOrIngredient_AndNothingIsChanged', () => {
        expect(ids(arrange(rows, 'date', false, 'zinc'))).toBe('a');
        expect(ids(arrange(rows, 'date', false, 'फूट'))).toBe('bc');
        expect(ids(arrange(rows, 'date', false, 'lambda'))).toBe('abc');
        expect(rows[0].dayOfSeason).toBeNull();
    });

    it('TypingInTheFilterBox_NarrowsTheRows', async () => {
        await open(ledgerOf(rows));
        await screen.findAllByTestId('season-ledger-row');
        fireEvent.change(screen.getByTestId('season-ledger-filter'), { target: { value: 'boron' } });
        expect(screen.getAllByTestId('season-ledger-row')).toHaveLength(1);
    });
});

describe('season ledger: reading the server answer', () => {
    it('ParseLedger_KeepsBlanksBlank', () => {
        const parsed = parseLedger({
            from: '2026-01-01', to: '2026-11-19', notYetDerived: 1,
            rows: [{ inputItemId: 'i1', date: '2026-11-10', productSaid: 'Karate', derived: false, ingredients: [], amount: null, dayOfSeason: null }],
            products: [], ingredients: [],
        });
        expect(parsed?.rows[0].amount).toBeNull();
        expect(parsed?.rows[0].dayOfSeason).toBeNull();
        expect(parsed?.notYetDerived).toBe(1);
    });

    it.each([[null], ['x'], [{ rows: 'no' }], [{ rows: [{ date: '2026-01-01' }], products: [], ingredients: [] }]])('ParseLedger_%j_DrawsNothing', (bad) => {
        expect(parseLedger(bad)).toBeNull();
    });
});
