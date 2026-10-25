// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The bottom bar (founder-approved 2026-10-25): the same five places in the same order, one line-icon set, even columns, a green pill for where
 * you are, and the raised शेड्यूल button in its own cradle.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BottomNavigation from '../BottomNavigation';

vi.mock('../../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../shared/utils/haptics', () => ({ hapticFeedback: { medium: () => undefined } }));

afterEach(cleanup);
const props = (over = {}) => ({ currentRoute: 'main' as never, currentView: 'log' as never, onNavigate: vi.fn(), onViewChange: vi.fn(), ...over });

describe('bottom bar', () => {
    it('shows the five places in the same order, each with a line icon from the one set', () => {
        render(<BottomNavigation {...props()} />);
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        expect([...document.querySelectorAll('[data-nav-icon]')].map(e => e.getAttribute('data-nav-icon')))
            .toEqual(['attention', 'procure', 'schedule', 'income', 'tests']);
    });

    it('each button goes where it always went', () => {
        const onNavigate = vi.fn();
        render(<BottomNavigation {...props({ onNavigate })} />);
        fireEvent.click(screen.getByTestId('procurement-nav-btn'));
        fireEvent.click(screen.getByTestId('nav-schedule'));
        fireEvent.click(screen.getByTestId('nav-income'));
        expect(onNavigate.mock.calls.map(c => c[0])).toEqual(['procurement', 'schedule', 'income']);
    });

    it('marks the current place with the green pill', () => {
        render(<BottomNavigation {...props({ currentRoute: 'income' as never })} />);
        expect(screen.getByTestId('nav-income').getAttribute('aria-current')).toBe('page');
        expect(screen.getByTestId('nav-income').querySelector('.bg-emerald-100')).toBeTruthy();
        expect(screen.getByTestId('procurement-nav-btn').querySelector('.bg-emerald-100')).toBeNull();
        expect(screen.getByTestId('nav-schedule').getAttribute('aria-current')).toBeNull();
    });

    it('the raised शेड्यूल button sits in its own white cradle (it never floats over the page)', () => {
        render(<BottomNavigation {...props()} />);
        expect(screen.getByTestId('nav-cradle')).toBeTruthy();
    });

});
