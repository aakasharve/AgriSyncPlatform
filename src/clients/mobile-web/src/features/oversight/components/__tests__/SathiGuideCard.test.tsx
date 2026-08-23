// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13, change 3; Task 14; Task 15; Task 16; Task 17)
 *
 * Pins `SathiGuideCard`'s founder-approved copy, its three instruction
 * rows (Task 17), the headline's emerald emphasis split, and the
 * left-character / right-text layout the founder's finished reference
 * image specifies.
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
    it('renders every founder-approved copy line, verbatim, including the third instruction line (Task 17)', () => {
        render(<SathiGuideCard />);

        expect(screen.getByText(oversightTranslations.mr.guideGreeting)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine1)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine2)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine3)).toBeInTheDocument();
        // The headline is split across nodes (emphasis word), so assert on
        // the card's full text content instead of a single getByText.
        expect(screen.getByTestId('sathi-guide-card')).toHaveTextContent(
            oversightTranslations.mr.guideHeadline,
        );
    });

    it('guideLine3 is the reworded "Entire Farm" caveat, with single curly quotes, not the old guideLine2 text', () => {
        // Task 17 — the founder reworded Task 13's original guideLine2 and
        // moved it to slot 3. Pin the exact reworded string so a future
        // edit can't silently drift from what the founder approved.
        expect(oversightTranslations.mr.guideLine3).toBe(
            'काम प्लॉटशी संबंधित नसेल, तरच खाली ‘संपूर्ण शेत’ निवडा.',
        );
        // The reworded string is gone from guideLine2's old wording.
        expect(oversightTranslations.mr.guideLine2).not.toContain('संपूर्ण शेत');
    });

    it('the emphasis word (प्लॉटवर) is its own node, styled emerald, distinct from the rest of the headline', () => {
        render(<SathiGuideCard />);

        const emphasis = screen.getByText('प्लॉटवर');
        expect(emphasis.tagName).toBe('SPAN');
        expect(emphasis.className).toContain('emerald');
    });

    it('renders the character LEFT (~40% of the card) with the text column RIGHT, per the founder\'s reference image (Task 17)', () => {
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const img = card.querySelector('img') as HTMLImageElement;
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('/images/sathi/sathi-points-down-both.png');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('width')).toBe('1086');
        expect(img.getAttribute('height')).toBe('1448');
        // object-contain, never squashed.
        expect(img.className).toContain('object-contain');

        // Character column is the card's FIRST child (screen LEFT), sized
        // to roughly 40% of the card's width; the text column is SECOND
        // (screen RIGHT) and grows to fill the rest.
        const children = Array.from(card.children).filter(
            (el) => el.getAttribute('data-testid') !== 'sathi-guide-leaf-watermarks',
        );
        expect(children).toHaveLength(2);
        const [characterColumn, textColumn] = children;
        expect(characterColumn.contains(img)).toBe(true);
        expect(characterColumn.className).toContain('w-[40%]');
        expect(textColumn.className).toContain('flex-1');
        expect(textColumn.contains(img)).toBe(false);
    });

    it('the character stands on the hill graphic (Task 17, change 2)', () => {
        render(<SathiGuideCard />);

        expect(screen.getByTestId('sathi-guide-hill')).toBeInTheDocument();
        expect(screen.getByTestId('sathi-guide-leaf-watermarks')).toBeInTheDocument();
    });

    it('renders three instruction rows, each with its own icon glyph', () => {
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const rows = card.querySelectorAll('ul > li');
        expect(rows).toHaveLength(3);
        rows.forEach((row) => {
            expect(row.querySelector('svg')).toBeTruthy();
        });
    });

    it('the headline is the largest text in the card', () => {
        render(<SathiGuideCard />);

        const card = screen.getByTestId('sathi-guide-card');
        const headline = card.querySelector('h2') as HTMLElement;
        expect(headline).toBeTruthy();

        // No other text node in the card declares a size at or above the
        // headline's own size.
        const headlineSizeMatch = /text-\[(\d+)px\]/.exec(headline.className);
        expect(headlineSizeMatch).toBeTruthy();
        const headlineSize = Number(headlineSizeMatch![1]);

        const oversizedSiblings = Array.from(card.querySelectorAll('p, span'))
            .filter((el) => el !== headline)
            .filter((el) => {
                const match = /text-\[(\d+)px\]/.exec(el.className);
                return match ? Number(match[1]) >= headlineSize : false;
            });
        expect(oversizedSiblings).toHaveLength(0);
    });

    it('english language resolves the english headline and emphasises "plot"', () => {
        currentLanguage = 'en';
        render(<SathiGuideCard />);

        expect(screen.getByTestId('sathi-guide-card')).toHaveTextContent(
            oversightTranslations.en.guideHeadline,
        );
        const emphasis = screen.getByText('plot');
        expect(emphasis.className).toContain('emerald');

        // English also gets all three instruction lines.
        expect(screen.getByText(oversightTranslations.en.guideLine1)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.en.guideLine2)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.en.guideLine3)).toBeInTheDocument();
    });

    it('line 1 (the plot instruction) reads visually stronger than lines 2 and 3 (the supporting detail)', () => {
        // Task 14, change 2 — founder ruling, unchanged by Task 17: the
        // action line must outrank the lines beneath it. With three lines
        // now, 2 and 3 are equal supporting detail, not flattened to line
        // 1's own weight.
        render(<SathiGuideCard />);

        const line1 = screen.getByText(oversightTranslations.mr.guideLine1);
        const line2 = screen.getByText(oversightTranslations.mr.guideLine2);
        const line3 = screen.getByText(oversightTranslations.mr.guideLine3);

        expect(line1.className).toContain('font-extrabold');
        expect(line1.className).toContain('text-stone-800');
        expect(line2.className).not.toContain('font-extrabold');
        expect(line2.className).toContain('text-stone-600');
        expect(line3.className).not.toContain('font-extrabold');
        expect(line3.className).toContain('text-stone-600');
    });
});
