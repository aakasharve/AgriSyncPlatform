// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the दरपत्रक still writes through the real
 * `financeCommandService.createPriceBookItem`, with the same fields as the English Price Book (a blank
 * unit is still stored as `unit`). "दर बदला" fills the form from a rate and writes a NEW dated rate through
 * the same call — there is no in-place edit to call. A blank price is refused instead of being stored as
 * ₹ 0, and the page never claims the rate was kept (the payload is refused pending founder ruling D2).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { RATES } from './financeFixtures';

const h = vi.hoisted(() => ({ rates: [] as unknown[], create: vi.fn() }));

vi.mock('../../features/finance/financeService', () => ({ financeService: { getPriceBook: () => h.rates } }));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { createPriceBookItem: h.create } }));

import PriceBookPage from '../PriceBookPage';

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

beforeEach(() => { h.rates = RATES; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('every rate is listed', () => {
    it('name, ₹ per unit, kind and from-date; a server placeholder name or unit is not shown as English', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('price-row-pb1')).toHaveTextContent('फवारणी मजूर₹ 400 / दिवसमजुरी1 ऑक्टो, 2026 पासून');
        const pb2 = screen.getByTestId('price-row-pb2');
        expect(pb2).toHaveTextContent('नाव लिहिलेलं नाही');
        expect(pb2).toHaveTextContent('₹ 90');
        expect(pb2).not.toHaveTextContent('/');
    });

    it('one kind at a time', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-show-Labour'));
        expect(screen.getByTestId('price-row-pb1')).toBeInTheDocument();
        expect(screen.queryByTestId('price-row-pb2')).toBeNull();
        fireEvent.click(screen.getByTestId('price-show-Fuel'));
        expect(screen.getByTestId('price-empty')).toHaveTextContent('या प्रकारचा दर अजून लिहिलेला नाही.');
    });
});

describe('a new rate is written through the real service', () => {
    it('with the kind, name, unit, price and from-date the farmer gave', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-cat-Fuel'));
        type('price-item', '  डिझेल ');
        type('price-rate', '94');
        type('price-unit', 'लिटर');
        type('price-date', '2026-10-20');
        fireEvent.click(screen.getByTestId('price-save'));
        expect(h.create).toHaveBeenCalledTimes(1);
        expect(h.create).toHaveBeenCalledWith({
            name: 'डिझेल', category: 'Fuel', defaultUnit: 'लिटर', defaultUnitPrice: 94, effectiveFrom: '2026-10-20', isActive: true,
        });
        // Honest: written to the list, not kept.
        expect(screen.getByTestId('price-written')).toHaveTextContent('अजून कायम जतन होत नाही');
        expect(screen.getByTestId('price-item')).toHaveValue('');
    });

    it('a blank unit is stored as before (`unit`), and the kind defaults to खत-औषध as before', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        type('price-item', 'युरिया');
        type('price-rate', '266');
        fireEvent.click(screen.getByTestId('price-save'));
        expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'युरिया', category: 'Input', defaultUnit: 'unit', defaultUnitPrice: 266, effectiveFrom: getDateKey() }));
    });

    it('no name or no price: nothing is written (a blank price used to be stored as ₹ 0)', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        type('price-item', 'युरिया');
        expect(screen.getByTestId('price-save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('price-save'));
        type('price-item', '');
        type('price-rate', '266');
        expect(screen.getByTestId('price-save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('price-save'));
        expect(h.create).not.toHaveBeenCalled();
    });
});

describe('"दर बदला" writes a new dated rate through the same call', () => {
    it('fills the form from the rate; the changed price is written from today, the old rate stays', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-change-pb1'));
        expect(screen.getByText('दर बदला — फवारणी मजूर')).toBeInTheDocument();
        expect(screen.getByTestId('price-item')).toHaveValue('फवारणी मजूर');
        expect(screen.getByTestId('price-rate')).toHaveValue(400);
        expect(screen.getByTestId('price-unit')).toHaveValue('दिवस');
        expect(screen.getByTestId('price-cat-Labour')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('price-date')).toHaveValue(getDateKey());

        type('price-rate', '450');
        fireEvent.click(screen.getByTestId('price-save'));
        expect(h.create).toHaveBeenCalledWith({
            name: 'फवारणी मजूर', category: 'Labour', defaultUnit: 'दिवस', defaultUnitPrice: 450, effectiveFrom: getDateKey(), isActive: true,
        });
        expect(screen.getByTestId('price-row-pb1')).toBeInTheDocument();
        expect(screen.getByText('नवीन दर')).toBeInTheDocument();
    });

    it('a server rate with no name or unit does not carry the placeholders into the form', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-change-pb2'));
        expect(screen.getByTestId('price-item')).toHaveValue('');
        expect(screen.getByTestId('price-unit')).toHaveValue('');
        expect(screen.getByTestId('price-rate')).toHaveValue(90);
    });

    it('रद्द करा leaves the change without writing anything', () => {
        render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
        fireEvent.click(screen.getByTestId('price-change-pb1'));
        fireEvent.click(screen.getByTestId('price-change-cancel'));
        expect(screen.getByText('नवीन दर')).toBeInTheDocument();
        expect(screen.getByTestId('price-item')).toHaveValue('');
        expect(h.create).not.toHaveBeenCalled();
    });
});

it('an empty price book says so', () => {
    h.rates = [];
    render(<PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} />);
    expect(screen.getByTestId('price-empty')).toHaveTextContent('अजून एकही दर लिहिलेला नाही.');
});
