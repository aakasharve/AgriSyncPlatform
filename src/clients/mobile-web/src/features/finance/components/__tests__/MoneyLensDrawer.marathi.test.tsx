// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the money drawer behind a tapped amount speaks
// Marathi, and a cleared amount box can never save the entry as ₹ 0.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { applyAdjustment, markAsDuplicate } = vi.hoisted(() => ({ applyAdjustment: vi.fn(), markAsDuplicate: vi.fn() }));
vi.mock('../../financeCommandService', () => ({ financeCommandService: { applyAdjustment, markAsDuplicate } }));
vi.mock('../../financeSelectors', () => ({
    financeSelectors: {
        getBreakdown: () => ({
            totals: { totalExpense: 1250, totalIncome: 0, unverifiedTotal: 1250 },
            lines: [{
                id: 'm1', category: 'Input', sourceType: 'Procurement', vendorName: 'कृषी सेवा केंद्र',
                dateTime: '2026-10-25T06:00:00.000Z', effectiveAmount: 1250, notes: '',
                trustStatus: 'Unverified', reviewStatus: 'None',
            }],
        }),
    },
}));

import { MoneyLensDrawer } from '../MoneyLensDrawer';

describe('the money drawer', () => {
    beforeEach(() => { cleanup(); applyAdjustment.mockReset(); });

    it('has no English words', () => {
        render(<MoneyLensDrawer isOpen onClose={() => {}} />);
        fireEvent.click(screen.getByText('दुरुस्त करा'));
        const text = document.body.textContent ?? '';
        expect(text.match(/[A-Za-z]{2,}/g) ?? []).toEqual([]);
        expect(text).toContain('₹ 1,250');
        expect(text).toContain('खत-औषध');
    });

    it('a cleared amount box cannot save the entry as ₹ 0', () => {
        render(<MoneyLensDrawer isOpen onClose={() => {}} />);
        fireEvent.click(screen.getByText('दुरुस्त करा'));
        fireEvent.change(screen.getByPlaceholderText('बरोबर रक्कम'), { target: { value: '' } });
        const save = screen.getByText('दुरुस्ती जतन करा');
        expect(save).toBeDisabled();
        fireEvent.click(save);
        expect(applyAdjustment).not.toHaveBeenCalled();
    });

    it('a stated amount is saved as the difference from the current one', () => {
        render(<MoneyLensDrawer isOpen onClose={() => {}} />);
        fireEvent.click(screen.getByText('दुरुस्त करा'));
        fireEvent.change(screen.getByPlaceholderText('बरोबर रक्कम'), { target: { value: '1000' } });
        fireEvent.click(screen.getByText('दुरुस्ती जतन करा'));
        expect(applyAdjustment).toHaveBeenCalledWith(expect.objectContaining({ adjustsMoneyEventId: 'm1', deltaAmount: -250 }));
    });
});

describe('marking an entry as a duplicate', () => {
    beforeEach(() => { cleanup(); markAsDuplicate.mockReset(); });

    it('asks first: one tap writes nothing, "हो, काढा" writes the ₹ 0 correction once', () => {
        render(<MoneyLensDrawer isOpen onClose={() => {}} />);
        fireEvent.click(screen.getByText('दुरुस्त करा'));
        fireEvent.click(screen.getByText('दुहेरी नोंद म्हणून काढा'));
        expect(markAsDuplicate).not.toHaveBeenCalled();
        expect(screen.getByTestId('duplicate-confirm')).toHaveTextContent('₹ 0');

        fireEvent.click(screen.getByText('हो, काढा'));
        expect(markAsDuplicate).toHaveBeenCalledTimes(1);
        expect(markAsDuplicate).toHaveBeenCalledWith('m1', 'owner');
    });

    it('"नको" writes nothing', () => {
        render(<MoneyLensDrawer isOpen onClose={() => {}} />);
        fireEvent.click(screen.getByText('दुरुस्त करा'));
        fireEvent.click(screen.getByText('दुहेरी नोंद म्हणून काढा'));
        fireEvent.click(screen.getByText('नको'));
        expect(markAsDuplicate).not.toHaveBeenCalled();
        expect(screen.queryByTestId('duplicate-confirm')).toBeNull();
    });
});
