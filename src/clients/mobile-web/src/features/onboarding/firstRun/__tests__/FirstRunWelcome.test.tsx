// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, LANG-1). स्वागत — the first screen,
 * before login, in the legacy look: gold "नमस्कार!", "तुमचं शेत, तुमच्या आवाजात", the Shram Sathi line,
 * a मराठी / English choice and "सुरू करूया". The choice changes the screen at once and is kept on the
 * phone. Rendered inside the REAL LanguageProvider (only its storage and server sync are stubbed).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../../pages/onboarding/DawnScene', () => ({ default: () => null }));
vi.mock('../../../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(_key: string, fallback: T) => {
            const [v, setV] = R.useState<T>(fallback);
            return [v, setV, true] as const;
        },
    };
});
vi.mock('../../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ meContext: null }) }));

import { LanguageProvider } from '../../../../i18n/LanguageContext';
import FirstRunWelcome from '../FirstRunWelcome';
import { readDeviceLanguage } from '../../../../infrastructure/storage/FirstRunDeviceStore';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const mount = (onStart = vi.fn()) => {
    render(<LanguageProvider><FirstRunWelcome onStart={onStart} /></LanguageProvider>);
    return onStart;
};

describe('स्वागत — the first screen', () => {
    it('says the approved words, in Marathi, with Marathi chosen', () => {
        mount();
        expect(screen.getByTestId('first-run-hello')).toHaveTextContent('नमस्कार!');
        expect(screen.getByTestId('first-run-tagline')).toHaveTextContent('तुमचं शेत, तुमच्या आवाजात');
        expect(screen.getByTestId('first-run-sathi')).toHaveTextContent('मी श्रम साथी. रोज शेतात काय झालं ते मला बोलून सांगा — बाकी हिशोब मी ठेवतो.');
        expect(screen.getByTestId('first-run-start')).toHaveTextContent('सुरू करूया');
        expect(screen.getByTestId('first-run-lang-mr')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('first-run-lang-en')).toHaveAttribute('aria-pressed', 'false');
        // No back on the first screen: there is nothing before it.
        expect(screen.queryByRole('button', { name: 'मागे' })).toBeNull();
        // The only Latin text is the name of the other language on its own chip.
        const text = (screen.getByTestId('first-run-welcome').textContent ?? '').replace('English', '');
        expect(text).not.toMatch(/[A-Za-z]{3,}/);
    });

    it('choosing English changes this screen at once and is kept on the phone', () => {
        mount();
        fireEvent.click(screen.getByTestId('first-run-lang-en'));
        expect(screen.getByTestId('first-run-hello')).toHaveTextContent('Namaskar!');
        expect(screen.getByTestId('first-run-start')).toHaveTextContent("Let's start");
        expect(screen.getByTestId('first-run-lang-en')).toHaveAttribute('aria-pressed', 'true');
        expect(readDeviceLanguage()).toBe('en');

        fireEvent.click(screen.getByTestId('first-run-lang-mr'));
        expect(screen.getByTestId('first-run-hello')).toHaveTextContent('नमस्कार!');
        expect(readDeviceLanguage()).toBe('mr');
    });

    it('"सुरू करूया" goes on (to the phone number); it asks nothing and stores no personal data', () => {
        const onStart = mount();
        fireEvent.click(screen.getByTestId('first-run-start'));
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(screen.queryByRole('checkbox')).toBeNull();
    });
});
