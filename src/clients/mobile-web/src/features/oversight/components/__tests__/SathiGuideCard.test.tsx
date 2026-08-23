// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3)
 *
 * Pins `SathiGuideCard`'s founder-approved copy and the headline's emerald
 * emphasis split.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { Language } from '../../../../i18n/language';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';

let currentLanguage: Language = 'mr';
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: currentLanguage,
        setLanguage: () => { },
        t: (key: string) => key,
    }),
}));

import SathiGuideCard from '../SathiGuideCard';

afterEach(() => {
    cleanup();
    currentLanguage = 'mr';
});

describe('SathiGuideCard — the centrepiece guide card (Task 13, change 3)', () => {
    it('renders every founder-approved copy line, verbatim', () => {
        render(<SathiGuideCard />);

        expect(screen.getByText(oversightTranslations.mr.guideGreeting)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine1)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine2)).toBeInTheDocument();
        // The headline is split across nodes (emphasis word), so assert on
        // the card's full text content instead of a single getByText.
        expect(screen.getByTestId('sathi-guide-card')).toHaveTextContent(
            oversightTranslations.mr.guideHeadline,
        );
    });

    it('the emphasis word (प्लॉटवर) is its own node, styled emerald, distinct from the rest of the headline', () => {
        render(<SathiGuideCard />);

        const emphasis = screen.getByText('प्लॉटवर');
        expect(emphasis.tagName).toBe('SPAN');
        expect(emphasis.className).toContain('emerald');
    });

    it('renders the Sathi image bled to the card, with explicit width/height and lazy loading', () => {
        render(<SathiGuideCard />);

        const img = screen.getByTestId('sathi-guide-card').querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/images/sathi/sathi-guide.png');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('width')).toBe('1086');
        expect(img.getAttribute('height')).toBe('1448');
    });

    it('english language resolves the english headline and emphasises "plot"', () => {
        currentLanguage = 'en';
        render(<SathiGuideCard />);

        expect(screen.getByTestId('sathi-guide-card')).toHaveTextContent(
            oversightTranslations.en.guideHeadline,
        );
        const emphasis = screen.getByText('plot');
        expect(emphasis.className).toContain('emerald');
    });
});
