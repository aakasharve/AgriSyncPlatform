// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The guide card's LABOUR arrival variant.
 *
 * FOUNDER RULING 2026-08-31. He saw the हजेरी wording land on the ordinary log
 * page and corrected the ask: "aaj kontya plot vr kam zali it must remain as it
 * is, it should change when it's being navigated from labour management pages."
 * So the default copy is untouched, and the हजेरी sentences appear ONLY when
 * `logIntent === 'labour'` — threaded in as `forLabour` from mainView.tsx.
 *
 * Revert-proof: drop the `forLabour` branch and the first two tests fail —
 * the labour path stops naming हजेरी, and the two variants stop differing.
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

describe('SathiGuideCard — the labour arrival variant', () => {
    it('asks for हजेरी when the farmer arrived from Labour Management', () => {
        render(<SathiGuideCard forLabour />);
        const card = screen.getByTestId('sathi-guide-card');
        expect(card).toHaveTextContent(oversightTranslations.mr.labourGuideHeadline);
        expect(screen.getByText(oversightTranslations.mr.labourGuideLine1)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.labourGuideLine2)).toBeInTheDocument();
    });

    // His actual correction: the ORDINARY log page must be left alone.
    it('leaves the default log-page copy exactly as it was', () => {
        render(<SathiGuideCard />);
        const card = screen.getByTestId('sathi-guide-card');
        expect(card).toHaveTextContent(oversightTranslations.mr.guideHeadline);
        expect(screen.getByText(oversightTranslations.mr.guideLine1)).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.guideLine2)).toBeInTheDocument();
        // and it does NOT ask for हजेरी
        expect(card.textContent ?? '').not.toContain('हजेरी');
    });

    // guideLine3 explains the संपूर्ण शेत button sitting directly below the
    // card. That button is on both paths, so the line is kept on both.
    it('keeps the संपूर्ण शेत caveat on the labour path too', () => {
        render(<SathiGuideCard forLabour />);
        expect(screen.getByText(oversightTranslations.mr.guideLine3)).toBeInTheDocument();
    });

    // The emphasis is a substring match that fails SILENTLY — an unemphasised
    // headline looks like a design choice, not a bug. The default headline is
    // already guarded; the labour headline needs the same guard or a founder
    // reword could quietly kill the emerald word on this path alone.
    it.each(['mr', 'en'] as const)(
        'the_emphasis_word_is_a_substring_of_the_labour_headline_in_every_language (%s)',
        (lang) => {
            expect(oversightTranslations[lang].labourGuideHeadline).toContain(EMPHASIS_WORD[lang]);
        },
    );

    it('renders the labour headline with its emphasis word in emerald', () => {
        currentLanguage = 'mr';
        render(<SathiGuideCard forLabour />);
        // `.text-emerald-600` is also worn by decorative icons in this card,
        // so match across ALL of them rather than assuming the first is the
        // headline span.
        const emerald = Array.from(
            screen.getByTestId('sathi-guide-card').querySelectorAll('.text-emerald-600'),
        ).map((el) => el.textContent);
        expect(emerald).toContain(EMPHASIS_WORD.mr);
    });
});
