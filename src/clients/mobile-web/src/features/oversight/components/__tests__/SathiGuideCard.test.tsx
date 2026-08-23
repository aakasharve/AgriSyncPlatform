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

    it('renders the whole-figure Sathi image, beside the instruction text in the card\'s last row, with explicit width/height and lazy loading', () => {
        // Task 16 — recomposed again: the headline is now the full-width
        // hero, and the instruction text + character sit SIDE BY SIDE in
        // one row below it (not stacked, not centred full-width — that was
        // Task 15's "character became the hero" problem). The character is
        // a fixed, noticeably smaller width so the text column measurably
        // out-sizes him.
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const img = card.querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/images/sathi/sathi-points-down-both.png');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('width')).toBe('1086');
        expect(img.getAttribute('height')).toBe('1448');
        // Fixed, noticeably smaller width — no longer a full-width centred
        // column (Task 15's `mx-auto` + `h-[186px]`/`h-[206px]`).
        expect(img.className).toContain('w-[92px]');
        expect(img.className).not.toContain('mx-auto');

        // The row containing the image is the card's LAST child ("low in
        // the card", per the founder's own framing), and within that row
        // the text column comes BEFORE the image (text reached first).
        const children = Array.from(card.children);
        const lastRow = children[children.length - 1];
        expect(lastRow.contains(img)).toBe(true);
        const rowChildren = Array.from(lastRow.children);
        const imgIndexInRow = rowChildren.indexOf(img);
        expect(imgIndexInRow).toBe(rowChildren.length - 1);
        expect(imgIndexInRow).toBeGreaterThan(0);
    });

    it('the headline is bigger than before and is the largest text in the card', () => {
        // Founder: "text must be bigger... character is helper, not hero."
        // Bumped from 21px/23px to 27px/30px.
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const headline = card.querySelector('h2') as HTMLElement;
        expect(headline).toBeTruthy();
        expect(headline.className).toContain('text-[27px]');
        expect(headline.className).toContain('sm:text-[30px]');

        // No other text node in the card declares a size at or above the
        // headline's own 27px.
        const oversizedSiblings = Array.from(card.querySelectorAll('p, span'))
            .filter((el) => el !== headline)
            .filter((el) => /text-\[(2[7-9]|[3-9]\d)px\]/.test(el.className));
        expect(oversizedSiblings).toHaveLength(0);
    });

    it('the text column measurably out-widths the character', () => {
        // Founder: "the text column should take clearly more width than he
        // does; he is an accent, not a panel." The text column is `flex-1`
        // (grows), the character is a small fixed width.
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const img = card.querySelector('img') as HTMLImageElement;
        const row = img.parentElement as HTMLElement;
        const textColumn = row.firstElementChild as HTMLElement;

        expect(textColumn).not.toBe(img);
        expect(textColumn.className).toContain('flex-1');
        expect(img.className).toContain('w-[92px]');
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
