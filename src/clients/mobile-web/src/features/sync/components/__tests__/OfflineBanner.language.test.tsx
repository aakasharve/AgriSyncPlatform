// @vitest-environment jsdom
/**
 * spec: plr-d10-final-polish - the offline banner follows the screen's language (Marathi mode Marathi only, English mode English only).
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentLanguage: 'mr' | 'en' = 'mr';
vi.mock('../../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: currentLanguage, setLanguage: () => undefined, t: (k: string) => k }),
}));

import OfflineBanner from '../OfflineBanner';

const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });

describe('OfflineBanner words', () => {
    beforeEach(() => setOnline(false));
    afterEach(() => { cleanup(); setOnline(true); });

    it('Marathi mode: Marathi only, no Latin letters', () => {
        currentLanguage = 'mr';
        const view = render(<OfflineBanner />);
        const text = view.container.textContent ?? '';
        expect(text).toMatch(/[ऀ-ॿ]/);
        expect(text).not.toMatch(/[A-Za-z]/);
        expect(text).toContain('फोनवर ठेवलेले बदल नेट आल्यावर पाठवले जातील');
    });

    it('English mode: English only, no Devanagari', () => {
        currentLanguage = 'en';
        const view = render(<OfflineBanner />);
        const text = view.container.textContent ?? '';
        expect(text).toMatch(/[A-Za-z]/);
        expect(text).not.toMatch(/[ऀ-ॿ]/);
        expect(text).toContain('sent when the internet is back');
    });

    it('says nothing when online', () => {
        setOnline(true);
        currentLanguage = 'mr';
        expect(render(<OfflineBanner />).container.textContent).toBe('');
    });
});
