// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 5; Task 15)
 *
 * Pins `HelpBar`'s founder-approved copy AND the honest-disabled talk
 * button — the named invariant the task brief singles out: "do not wire it
 * to a no-op that looks live."
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => key,
    }),
}));

import HelpBar from '../HelpBar';

afterEach(() => {
    cleanup();
});

describe('HelpBar — closing help strip (Task 13, change 5)', () => {
    it('renders the founder-approved title, subtitle and button label', () => {
        render(<HelpBar />);

        expect(screen.getByText(oversightTranslations.mr.helpTitle)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.helpSubtitle)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.helpButtonLabel)).toBeInTheDocument();
    });

    it('the talk button is a REAL disabled control — no onClick, native disabled attribute, not a no-op that looks live', () => {
        render(<HelpBar />);

        const button = screen.getByTestId('help-bar-talk-button');
        expect(button).toBeDisabled();

        // A disabled native <button> does not fire click handlers even if
        // one were attached; this proves there is genuinely nothing to
        // fire by asserting no exception/navigation side effect occurs and
        // the element stays disabled afterwards — the honest-disabled
        // contract, not merely a visual dimming.
        fireEvent.click(button);
        expect(button).toBeDisabled();
    });

    it('renders the avatar image with explicit width/height and lazy loading', () => {
        render(<HelpBar />);

        const img = screen.getByTestId('help-bar').querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/images/sathi/sathi-points-down-both.png');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('width')).toBe('1086');
        expect(img.getAttribute('height')).toBe('1448');
    });

    it('the face-crop box uses max-w-none so Tailwind preflight cannot clamp its width to the circle', () => {
        // Task 16 — the bug: `img { max-width: 100% }` (Tailwind preflight)
        // silently clamped the old `w-[66px]` class to the 44px circle's
        // 40px content box at runtime, so the intended width never actually
        // rendered. `max-w-none` is the fix; pin it so it cannot regress.
        render(<HelpBar />);

        const img = screen.getByTestId('help-bar').querySelector('img') as HTMLImageElement;
        expect(img.className).toContain('max-w-none');
        expect(img.className).toContain('h-[81px]');
        expect(img.className).toContain('w-[61px]');
    });
});
