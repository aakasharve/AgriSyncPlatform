// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4 — Task 6.
 *
 * The shared honest surface every harvest entry point now renders instead of
 * the broken sale/config flow.
 *
 * FIX ROUND 1 — the original copy said "anything you already noted down here
 * is still on your phone", which independent review proved false: grade-wise
 * sale data (quantities, grades, prices, income, payment status) was NEVER
 * written by any code path, so there was no evidence a farmer's past sale was
 * "still there". The corrected copy makes only the evidenced claim — this
 * change deletes nothing — and says nothing about what a past entry currently
 * contains. This suite pins the CORRECTED claim positively (not merely "some
 * reassuring text exists") and separately asserts the specific false phrasing
 * does not reappear, so a future edit that quietly restores it fails here
 * rather than reaching a farmer.
 *
 * FIX ROUND 2 — EVERY PROPERTY BELOW NOW RUNS IN BOTH LANGUAGES. The copy was
 * English-only while the app defaults to Marathi (`i18n/LanguageContext.tsx`),
 * so the sentence that stops a farmer losing a sale could not be read by the
 * farmer it was written for. A suite that only asserted the English would have
 * stayed green through exactly that defect — it did, for the whole time the
 * defect was live — which is why the three facts are asserted per language
 * here rather than "in the rendered output" generically.
 *
 * The Marathi is asserted by its LITERAL text, not by a `toBeTruthy()` on the
 * resolver. A test that reads the same module the component reads passes no
 * matter what that module says; a hand-written second copy of the string fails
 * the moment either side is edited alone. Same oracle as
 * `i18n/__tests__/approvalAvailabilityTranslations.test.ts`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import HarvestComingSoon from '../HarvestComingSoon';
import { harvestAvailabilityTranslations } from '../../../../../i18n/harvestAvailabilityTranslations';
import { syncTranslations } from '../../../../../i18n/syncTranslations';
import type { Language } from '../../../../../i18n/language';

afterEach(() => {
    cleanup();
});

const LANGUAGES: Language[] = ['en', 'mr'];

/**
 * THE ORACLE — a second, hand-written copy of both strings, per language.
 * Typed `Record<Language, ...>`, so a language added to the union without a
 * pinned literal is a `tsc --noEmit` error rather than an untested screen.
 */
const EXPECTED: Record<Language, { title: string; body: string }> = {
    en: {
        title: 'Harvest tracking is coming soon',
        body:
            "This part of the app isn't built yet — a harvest sale recorded here would not be saved to your farm records. Nothing on your phone has been deleted.",
    },
    mr: {
        title: 'कापणीची नोंद आजून उपलब्ध नाहीये',
        body:
            'अॅपचा हा भाग आजून तयार नाही. इथे कापणीची विक्री नोंदवली तरी ती शेतनोंदीत जाणार नाही. तुमच्या फोनवरचं काहीही मिटवलेलं नाही.',
    },
};

/** THE THREE FACTS, in the order the copy must keep, per language. */
const FACTS: Record<Language, { notBuilt: string; notSaved: string; nothingDeleted: string }> = {
    en: {
        notBuilt: "This part of the app isn't built yet",
        notSaved: 'would not be saved to your farm records',
        nothingDeleted: 'Nothing on your phone has been deleted',
    },
    mr: {
        // 1. "this part of the app is not ready yet"
        notBuilt: 'अॅपचा हा भाग आजून तयार नाही',
        // 2. THE LOAD-BEARING ONE — "even if a harvest sale is recorded here,
        //    it will not go into your farm records"
        notSaved: 'शेतनोंदीत जाणार नाही',
        // 3. "nothing on your phone has been deleted"
        nothingDeleted: 'तुमच्या फोनवरचं काहीही मिटवलेलं नाही',
    },
};

function renderedText(): string {
    return screen.getByTestId('harvest-coming-soon').textContent || '';
}

describe('HarvestComingSoon', () => {
    describe.each(LANGUAGES)('language: %s', (language) => {
        it('renders the honest "not built yet" heading', () => {
            render(<HarvestComingSoon language={language} />);
            expect(screen.getByTestId('harvest-coming-soon')).toBeInTheDocument();
            expect(renderedText()).toContain(EXPECTED[language].title);
            expect(renderedText()).toContain(FACTS[language].notBuilt);
        });

        it('says plainly that a harvest sale would not be saved', () => {
            render(<HarvestComingSoon language={language} />);
            expect(renderedText()).toContain(FACTS[language].notSaved);
        });

        it('makes only the evidenced claim: this change deletes nothing', () => {
            render(<HarvestComingSoon language={language} />);
            expect(renderedText()).toContain(FACTS[language].nothingDeleted);
        });

        it('keeps the three facts in order — not built, not saved, nothing deleted', () => {
            render(<HarvestComingSoon language={language} />);
            const text = renderedText();
            const notBuilt = text.indexOf(FACTS[language].notBuilt);
            const notSaved = text.indexOf(FACTS[language].notSaved);
            const nothingDeleted = text.indexOf(FACTS[language].nothingDeleted);
            expect(notBuilt).toBeGreaterThanOrEqual(0);
            expect(notSaved).toBeGreaterThan(notBuilt);
            expect(nothingDeleted).toBeGreaterThan(notSaved);
        });

        it('renders the exact pinned copy, character for character', () => {
            render(<HarvestComingSoon language={language} />);
            const text = renderedText();
            expect(text).toContain(EXPECTED[language].title);
            expect(text).toContain(EXPECTED[language].body);
        });

        it('does NOT claim past harvest sale data is safe, kept, or retrievable', () => {
            // Fix round 1 regression guard: the false claim this fixed was
            // exactly "anything you already noted down here is still on your
            // phone; it has not been deleted" — an unevidenced promise about a
            // sale that was never written in the first place. Pin its absence
            // by the exact phrases that made it false, not by a vague "sounds
            // reassuring" check that a reworded false claim could still pass.
            render(<HarvestComingSoon language={language} />);
            const text = renderedText();
            expect(text).not.toMatch(/already noted down/i);
            expect(text).not.toMatch(/still on your phone/i);
            expect(text).not.toMatch(/your (records|sale)s? (is|are) (safe|kept|fine)/i);
            // Marathi equivalents of the same false claim: "still on the phone
            // / is saved". `सेव्ह` and `जतन` are the app's two words for "saved"
            // (`i18n/consentTranslations.ts:66,83`); neither may appear as a
            // POSITIVE claim about a past harvest sale, and neither appears at
            // all in this copy.
            expect(text).not.toContain('सेव्ह');
            expect(text).not.toContain('जतन');
        });

        it('promises no date', () => {
            render(<HarvestComingSoon language={language} />);
            const text = renderedText();
            // No month names, no "soon on", no explicit calendar reference
            // beyond the generic "coming soon" heading itself.
            expect(text).not.toMatch(/january|february|march|april|may|june|july|august|september|october|november|december/i);
            expect(text).not.toMatch(/\b\d{4}\b/); // no year
            expect(text).not.toMatch(/\bweek(s)?\b/i);
            // Marathi: no day/week/month unit, and no "लवकरच" ("very soon"),
            // which would be the Devanagari way to smuggle the same promise.
            expect(text).not.toContain('आठवड');
            expect(text).not.toContain('महिन');
            expect(text).not.toContain('लवकर');
        });

        it('offers no control that could start a new harvest write', () => {
            render(<HarvestComingSoon language={language} />);
            expect(screen.queryAllByRole('button')).toHaveLength(0);
            expect(screen.queryAllByRole('textbox')).toHaveLength(0);
        });
    });

    describe('the Marathi is readable, and is the app\'s own vocabulary', () => {
        it('sets the Marathi body font explicitly on every Devanagari string', () => {
            // `OfflineEmptyState` declares no font-family, so without this the
            // Marathi inherits whatever the cascade hands it. Project rule
            // (`CLAUDE.md` § Font Rules): Marathi body is 'Noto Sans
            // Devanagari', never a generic fallback.
            render(<HarvestComingSoon language="mr" />);
            const devanagari = /[\u0900-\u097F]/;
            const styled = Array.from(
                screen.getByTestId('harvest-coming-soon').querySelectorAll('span[style]'),
            ).filter((el) => devanagari.test(el.textContent || ''));
            expect(styled.length).toBeGreaterThanOrEqual(2);
            styled.forEach((el) => {
                expect((el as HTMLElement).style.fontFamily).toContain('Noto Sans Devanagari');
                expect((el as HTMLElement).style.fontFamily).not.toContain('system-ui');
                expect((el as HTMLElement).style.fontFamily).not.toContain('Arial');
            });
        });

        it('uses DM Sans for the English, not the Devanagari face', () => {
            render(<HarvestComingSoon language="en" />);
            const spans = Array.from(
                screen.getByTestId('harvest-coming-soon').querySelectorAll('span[style]'),
            ).filter((el) => (el.textContent || '').trim().length > 0);
            expect(spans.length).toBeGreaterThanOrEqual(2);
            spans.forEach((el) => {
                expect((el as HTMLElement).style.fontFamily).toContain('DM Sans');
            });
        });

        it('borrows the load-bearing clause VERBATIM from syncTranslations, and cannot drift from it', () => {
            // `शेतनोंदीत जाणार नाही` is `syncTranslations.mr
            // .notFiledBadgeTail` — the phrase this app already uses, on the
            // save toast and the record badge, for "will not reach your farm
            // records". Reusing it means the farmer meets a sentence he has
            // already been taught rather than a synonym. If either side is
            // ever reworded alone, this fails instead of the two quietly
            // teaching two different things.
            expect(harvestAvailabilityTranslations.mr.harvestUnavailableBody).toContain(
                syncTranslations.mr.notFiledBadgeTail,
            );
            expect(harvestAvailabilityTranslations.en.harvestUnavailableBody).toContain(
                'would not be saved to your farm records',
            );
        });

        it('neither language ships an empty string', () => {
            LANGUAGES.forEach((language) => {
                expect(harvestAvailabilityTranslations[language].harvestUnavailableTitle).not.toBe('');
                expect(harvestAvailabilityTranslations[language].harvestUnavailableBody).not.toBe('');
            });
        });

        it('keeps the founder\'s spelling आजून, not अजून', () => {
            // Transcribed from his own line at
            // `i18n/approvalAvailabilityTranslations.ts:111`. Normalising it
            // would be an agent overruling the founder on his own language.
            const title = harvestAvailabilityTranslations.mr.harvestUnavailableTitle;
            expect(title).toContain('आजून');
            expect(title).not.toContain('अजून');
        });
    });
});
