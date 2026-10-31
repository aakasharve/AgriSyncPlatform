// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder rule FOOT-1 (2026-10-31, register F80): nothing may sit behind the bottom bar. His screenshot: the
 * add-plot sheet "प्लॉट जोडा", step 3/3, its मागे / पुढे buttons hidden under the bar — 27 sheets used the bar's own layer
 * (`z-50`) and the bar is drawn after them. Now: while any sheet / pop-up / full-screen overlay is open the bar steps
 * away (as it does for the keyboard), and it is the app's base layer (z-40), below every sheet.
 *
 * HONESTY NOTE: jsdom has no layout, so "not drawn over it" is proven as "the bar is moved off screen and takes no
 * taps" (its own classes), and the base layer by its class. The real-phone measurement is in the lane report.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BottomNavigation from '../BottomNavigation';
import AddPlotWizard from '../../../profile/components/AddPlotWizard';
import type { CropProfile, FarmerProfile } from '../../../../types';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ t: (k: string) => k, language: 'mr' }),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));
vi.mock('../../../../shared/utils/haptics', () => ({ hapticFeedback: { medium: () => undefined, light: () => undefined } }));

afterEach(cleanup);

const navProps = { currentRoute: 'main' as never, currentView: 'log' as never, onNavigate: vi.fn() };
const bar = () => screen.getByTestId('bottom-nav');
const isAway = () => bar().getAttribute('data-hidden') === 'yes'
    && bar().classList.contains('translate-y-full') && bar().classList.contains('pointer-events-none');

/** A page with a sheet it can open and close, and the app's bar after it — the order AppContent draws them in. */
const Page: React.FC<{ sheet: (close: () => void) => React.ReactNode }> = ({ sheet }) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <main><button type="button" data-testid="open-sheet" onClick={() => setOpen(true)}>open</button></main>
            {open && sheet(() => setOpen(false))}
            <BottomNavigation {...navProps} />
        </>
    );
};

describe('FOOT-1 — the bar never sits over an open sheet', () => {
    it('the founder\'s add-plot sheet (प्लॉट जोडा): the bar steps away while it is open and comes back when it closes', async () => {
        const crop = { id: 'grape', name: 'Grapes', plots: [], iconName: 'Grape', color: 'emerald' } as unknown as CropProfile;
        const profile = { name: 'पुरुषोत्तम', operators: [], machineries: [], waterResources: [], electricityTiming: {} } as unknown as FarmerProfile;
        render(<Page sheet={close => <AddPlotWizard crop={crop} profile={profile} onSave={close} onCancel={close} />} />);
        expect(bar()).toHaveAttribute('data-hidden', 'no');
        fireEvent.click(screen.getByTestId('open-sheet'));
        await waitFor(() => expect(isAway()).toBe(true));
        // its own close (the ✕ in its header) — the bar is back
        fireEvent.click(document.querySelector('.fixed.inset-0 button') as HTMLElement);
        await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'no'));
        expect(bar().classList.contains('translate-y-full')).toBe(false);
    });

    it('a plain bottom sheet with its buttons at the bottom (the money / setup / हजेरी sheet shape): the bar steps away', async () => {
        render(<Page sheet={close => (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50">
                <div className="w-full rounded-t-3xl bg-white p-4"><button type="button" onClick={close}>मागे</button><button type="button">पुढे</button></div>
            </div>
        )} />);
        fireEvent.click(screen.getByTestId('open-sheet'));
        await waitFor(() => expect(isAway()).toBe(true));
        fireEvent.click(screen.getByText('मागे'));
        await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'no'));
    });

    it('a small menu\'s invisible tap-catcher does not hide the bar (nothing is drawn over it)', async () => {
        render(<Page sheet={() => <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-20 cursor-default" />} />);
        fireEvent.click(screen.getByTestId('open-sheet'));
        await act(async () => { await new Promise(r => setTimeout(r, 40)); });
        expect(bar()).toHaveAttribute('data-hidden', 'no');
    });

    it('with animation frames frozen (page not on screen), an overlay that comes and goes never leaves the bar hidden (live 2026-10-31)', async () => {
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
        try {
            render(<Page sheet={close => (
                <div className="fixed inset-0 z-50 bg-white"><button type="button" onClick={close}>मागे</button></div>
            )} />);
            fireEvent.click(screen.getByTestId('open-sheet'));
            await waitFor(() => expect(isAway()).toBe(true));
            fireEvent.click(screen.getByText('मागे'));
            await waitFor(() => expect(bar()).toHaveAttribute('data-hidden', 'no'));
        } finally {
            raf.mockRestore();
        }
    });

    it('the keyboard still hides it, as before', () => {
        render(<BottomNavigation {...navProps} hidden />);
        expect(isAway()).toBe(true);
    });

    it('the bar is the app\'s base layer: below every sheet (z-40 under their z-50 and up)', () => {
        render(<BottomNavigation {...navProps} />);
        expect(bar().classList.contains('z-40')).toBe(true);
        expect(bar().classList.contains('z-50')).toBe(false);
    });
});
