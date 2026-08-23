// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3; Task 14, changes 1-2; Task 15)
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

    it('renders the whole-figure Sathi image, below the text and centred, with explicit width/height and lazy loading', () => {
        // Task 15 — the new asset (`sathi-points-down-both.png`) is a
        // symmetric, both-hands, straight-down gesture; a side-by-side
        // left/right split (Task 14) would point half the gesture off the
        // card. Re-composed as a single column instead: text block first,
        // character second, centred, so his fingers lead the eye straight
        // down into the plot selector immediately beneath this card.
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const img = card.querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/images/sathi/sathi-points-down-both.png');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('width')).toBe('1086');
        expect(img.getAttribute('height')).toBe('1448');
        expect(img.className).toContain('mx-auto');

        // BELOW the text — the text block is the first element child, the
        // image the second (and last), in a flex column.
        const children = Array.from(card.children);
        const imgIndex = children.indexOf(img);
        expect(imgIndex).toBe(children.length - 1);
        expect(imgIndex).toBeGreaterThan(0);
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

    it('line 1 (the plot instruction) reads visually stronger than line 2 (the caveat)', () => {
        // Task 14, change 2 — founder ruling: keep BOTH lines, but the
        // action line must outrank the caveat beneath it, not merely
        // repeat its styling.
        render(<SathiGuideCard />);

        const line1 = screen.getByText(oversightTranslations.mr.guideLine1);
        const line2 = screen.getByText(oversightTranslations.mr.guideLine2);

        expect(line1.className).toContain('font-extrabold');
        expect(line1.className).toContain('text-stone-800');
        expect(line2.className).not.toContain('font-extrabold');
        expect(line2.className).toContain('text-stone-500');
    });
});
