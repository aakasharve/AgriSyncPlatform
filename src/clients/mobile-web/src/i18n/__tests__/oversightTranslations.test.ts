/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guards for `oversightTranslations.ts` — see that file's header for the
 * Hard Rule this module exists to enforce (spec §6, "no agent may invent
 * farmer-facing Marathi").
 *
 * Three failure modes matter here, and each gets its own test:
 *
 *   1. A key with an `mr` but no `en` (or vice versa) — silently breaks
 *      the "render the placeholder beside its English fallback" contract
 *      spec §6.2 requires for every pending string.
 *   2. `PENDING_FOUNDER_STRINGS` naming a key that does not exist — the
 *      easy way for that list to drift from the module it flags.
 *   3. A `dfesTranslations`-sourced value re-typed with a mistake — the
 *      exact failure mode that shipped inverted word order once already.
 *      This is the same pattern `translationsSplit.test.ts` uses to guard
 *      the DFES split: an independent oracle, not a self-comparison.
 */
import { describe, it, expect } from 'vitest';

import { oversightTranslations, PENDING_FOUNDER_STRINGS } from '../oversightTranslations';
import type { OversightTranslations } from '../oversightTranslations';
import { dfesTranslations } from '../dfesTranslations';
import type { DfesTranslations } from '../dfesTranslations';
import type { Language } from '../language';

const LANGUAGES: Language[] = ['en', 'mr'];

// The subset of oversightTranslations' keys copied verbatim from
// dfesTranslations.ts (spec §6.1). See oversightTranslations.ts's header
// comment for the file+line each was transcribed from. Typed against
// BOTH interfaces so `dfesTranslations[language][key]` below indexes
// safely — `attention`/`yourFarms`/etc. (OversightTranslations-only keys)
// are deliberately excluded from this list.
const DFES_SOURCED_KEYS: (keyof OversightTranslations & keyof DfesTranslations)[] = [
    'welcomeBack',
    'weeklyReviewPrompt',
    'farmBookOpen',
    'todayClosed',
    'needsReview',
    'unknown',
    'activitiesLogged',
    'entries',
];

describe('oversightTranslations — every_key_has_both_mr_and_en', () => {
    it('the en and mr blocks declare exactly the same key set', () => {
        // Catches a key added to one language and not the other — the
        // shape check `tsc` cannot perform because both sides of a
        // `Record<Language, OversightTranslations>` are typed identically
        // regardless of what was actually written into each literal.
        expect(Object.keys(oversightTranslations.en).sort())
            .toEqual(Object.keys(oversightTranslations.mr).sort());
    });

    it('every declared value is a non-empty string in both languages', () => {
        for (const language of LANGUAGES) {
            for (const [key, value] of Object.entries(oversightTranslations[language])) {
                expect(typeof value, `${language}.${key} should be a string`).toBe('string');
                expect(value.length, `${language}.${key} should not be empty`).toBeGreaterThan(0);
            }
        }
    });

    it('every mr value contains Devanagari and every en value does not', () => {
        // The quietest way this module could go wrong: an English string
        // typed into the `mr` block (or vice versa) by accident.
        const devanagari = /[ऀ-ॿ]/;
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(devanagari.test(value), `mr.${key} should contain Devanagari`).toBe(true);
        }
        for (const [key, value] of Object.entries(oversightTranslations.en)) {
            expect(devanagari.test(value), `en.${key} should not contain Devanagari`).toBe(false);
        }
    });
});

describe('oversightTranslations — pending_founder_strings_are_all_declared_keys', () => {
    it('every entry in PENDING_FOUNDER_STRINGS is a real key of OversightTranslations', () => {
        const declaredKeys = new Set(Object.keys(oversightTranslations.mr));
        for (const pendingKey of PENDING_FOUNDER_STRINGS) {
            expect(declaredKeys.has(pendingKey), `PENDING_FOUNDER_STRINGS names unknown key "${pendingKey}"`).toBe(true);
        }
    });

    it('PENDING_FOUNDER_STRINGS is non-empty — spec §6.2 has real unresolved strings', () => {
        // A test that could never fail is worth nothing; this pins the
        // list to actually flagging something rather than silently
        // shrinking to empty as a way to make the previous test pass.
        expect(PENDING_FOUNDER_STRINGS.length).toBeGreaterThan(0);
    });

    it('every spec §6.2 concept is represented in PENDING_FOUNDER_STRINGS', () => {
        const expectedPending = [
            'waitingLabel',
            'restState',
            'seenControl',
            'decisionLine',
            'delegatedLine',
            'failedSends',
            'recordBarIdle',
            'recordBarActive',
        ];
        expect([...PENDING_FOUNDER_STRINGS].sort()).toEqual(expectedPending.sort());
    });

    it('no reused (spec §6.1) key is ever flagged pending', () => {
        for (const key of DFES_SOURCED_KEYS) {
            expect(PENDING_FOUNDER_STRINGS.includes(key), `${key} is approved copy and must not be pending`).toBe(false);
        }
    });
});

describe('oversightTranslations — reused_repo_strings_match_dfesTranslations_exactly', () => {
    for (const language of LANGUAGES) {
        it(`${language}: every DFES-sourced value is byte-identical to dfesTranslations.ts`, () => {
            for (const key of DFES_SOURCED_KEYS) {
                expect(oversightTranslations[language][key]).toBe(dfesTranslations[language][key]);
            }
        });
    }
});

describe('oversightTranslations — the Seen control never implies a decision (spec §P-G, §6.2)', () => {
    it('seenControl carries neither मंजूर (approve) nor खात्री (confirm)', () => {
        expect(oversightTranslations.mr.seenControl).not.toContain('मंजूर');
        expect(oversightTranslations.mr.seenControl).not.toContain('खात्री');
    });
});
