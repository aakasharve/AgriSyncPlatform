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

import SathiGuideCard, { EMPHASIS_WORD } from '../SathiGuideCard';

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

    it('the_emphasis_word_is_a_substring_of_the_founder_headline_in_every_language', () => {
        // FINDING F7(b). `EMPHASIS_WORD` is a hardcoded constant in
        // `SathiGuideCard.tsx`; the component finds it inside
        // `guideHeadline` with `indexOf` and, when that returns -1, renders
        // the headline UNEMPHASISED and says nothing. So a founder reword of
        // the headline that no longer contains this exact word would
        // silently drop the emerald emphasis he asked for — it would still
        // compile, still render, still pass the test directly above (which
        // only checks the word when the split already worked).
        //
        // This asserts the RELATIONSHIP itself, in both languages,
        // independently of rendering: the constant and the copy must stay
        // joined. The two are in different files, so nothing else connects
        // them.
        for (const language of ['mr', 'en'] as const) {
            const headline = oversightTranslations[language].guideHeadline;
            const word = EMPHASIS_WORD[language];
            expect(word.length, `EMPHASIS_WORD.${language} must not be empty`).toBeGreaterThan(0);
            expect(
                headline.includes(word),
                `EMPHASIS_WORD.${language} ("${word}") is no longer inside guideHeadline ("${headline}") — the emerald emphasis would silently disappear`,
            ).toBe(true);
        }
    });

    it('the_emphasised_node_renders_exactly_the_constant_in_both_languages', () => {
        // The runtime half of the pin above: the emerald span's text is the
        // constant itself, not merely "some emerald text". Proves the split
        // actually took the `indexOf` branch rather than falling through to
        // the unemphasised headline.
        for (const language of ['mr', 'en'] as const) {
            currentLanguage = language;
            render(<SathiGuideCard />);

            const emphasis = screen.getByText(EMPHASIS_WORD[language]);
            expect(emphasis.tagName, language).toBe('SPAN');
            expect(emphasis.className, language).toContain('emerald');
            expect(emphasis.textContent, language).toBe(EMPHASIS_WORD[language]);

            cleanup();
        }
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

    it('the hill is gone; the character overflows past the card\'s bottom edge, and the leaf watermarks stay clipped (founder review round, post-Task 17)', () => {
        render(<SathiGuideCard />);

        // Fix 1 — the hill graphic no longer exists anywhere in the tree.
        expect(screen.queryByTestId('sathi-guide-hill')).not.toBeInTheDocument();

        // The leaf watermarks are unaffected and still present.
        expect(screen.getByTestId('sathi-guide-leaf-watermarks')).toBeInTheDocument();

        // Fix 2 — the card allows overflow (so the character can break out
        // of it) and no longer clips its own contents.
        const card = screen.getByTestId('sathi-guide-card');
        expect(card.className).toContain('overflow-visible');
        expect(card.className).not.toContain('overflow-hidden');

        // The leaf watermarks clip themselves independently of the card's
        // own overflow setting, so they can never escape it.
        const watermarks = screen.getByTestId('sathi-guide-leaf-watermarks');
        expect(watermarks.className).toContain('overflow-hidden');

        // The character image is pulled past the column's own bottom edge
        // with a negative offset, and is inert to pointer events so it can
        // never cover a tap meant for the plot selector below it.
        const img = card.querySelector('img') as HTMLImageElement;
        expect(img.className).toContain('h-[calc(100%+20px)]');
        expect(img.className).toContain('pointer-events-none');
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
