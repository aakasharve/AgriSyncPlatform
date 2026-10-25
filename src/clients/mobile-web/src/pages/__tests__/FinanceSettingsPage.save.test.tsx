// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — हिशोबाची सेटिंग still saves both numbers through
 * the real `financeService.saveSettings`, with the same fallback to the stored value. Nothing reads them yet,
 * so the page says using them is still to come; GST, which nothing reads either, is "लवकरच" instead of a
 * checkbox that did nothing, and its stored value is kept as it was.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock('../../features/finance/financeService', () => ({
    financeService: {
        getSettings: () => ({ highAmountThreshold: 25000, duplicateWindowMinutes: 120, gstEnabled: true }),
        saveSettings: h.save,
    },
}));

import FinanceSettingsPage from '../FinanceSettingsPage';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('हिशोबाची सेटिंग', () => {
    it('shows the stored numbers and saves the changed ones; the stored GST value is kept', () => {
        render(<FinanceSettingsPage currentRoute="finance-settings" onNavigate={vi.fn()} />);
        expect(screen.getByTestId('fin-threshold')).toHaveValue(25000);
        expect(screen.getByTestId('fin-dup-window')).toHaveValue(120);
        fireEvent.change(screen.getByTestId('fin-threshold'), { target: { value: '5000' } });
        fireEvent.change(screen.getByTestId('fin-dup-window'), { target: { value: '10' } });
        fireEvent.click(screen.getByTestId('fin-settings-save'));
        expect(h.save).toHaveBeenCalledWith({ highAmountThreshold: 5000, duplicateWindowMinutes: 10, gstEnabled: true });
        expect(screen.getByTestId('fin-settings-saved')).toHaveTextContent('जतन झालं ✓');
    });

    it('a blank or zero number falls back to the stored one, as before', () => {
        render(<FinanceSettingsPage currentRoute="finance-settings" onNavigate={vi.fn()} />);
        fireEvent.change(screen.getByTestId('fin-threshold'), { target: { value: '' } });
        fireEvent.change(screen.getByTestId('fin-dup-window'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('fin-settings-save'));
        expect(h.save).toHaveBeenCalledWith({ highAmountThreshold: 25000, duplicateWindowMinutes: 120, gstEnabled: true });
    });

    it('says plainly what is not built yet, and offers no control that does nothing', () => {
        render(<FinanceSettingsPage currentRoute="finance-settings" onNavigate={vi.fn()} />);
        const soon = screen.getAllByTestId('soon').map(el => el.textContent);
        expect(soon).toEqual([
            'इथं लिहिलेली मर्यादा आणि वेळ नोंदी तपासताना वापरणं — लवकरच.',
            'बिलावरचा जीएसटी वेगळा दाखवणं — लवकरच.',
        ]);
        expect(screen.queryByRole('checkbox')).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.getByTestId('setup-this-phone-only')).toBeInTheDocument();
    });
});
