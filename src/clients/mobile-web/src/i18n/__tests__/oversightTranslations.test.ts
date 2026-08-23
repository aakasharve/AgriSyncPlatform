/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guards for `oversightTranslations.ts` — see that file's header for the
 * Hard Rule this module exists to enforce (spec §6, "no agent may invent
 * farmer-facing Marathi") and for Controller Ruling 7 (the original six
 * "keyless-but-declared" keys whose `mr` is the literal empty string) plus
 * Ruling 8 (two more keys added by Task 5 / `WaitingDrawer`, following the
 * exact same pattern — see `oversightTranslations.ts`'s "TASK 5 ADDITIONS"
 * header section).
 *
 * Failure modes covered, one test group each:
 *
 *   1. A key with an `mr` but no `en` (or vice versa) — silently breaks
 *      the "render the placeholder beside its English fallback" contract
 *      spec §6.2 requires for every pending string. For the eight Ruling-7/8
 *      keys the correct `mr` is deliberately `''`, so this group also
 *      pins that emptiness explicitly rather than just tolerating it.
 *   2. `PENDING_FOUNDER_STRINGS` naming a key that does not exist — the
 *      easy way for that list to drift from the module it flags.
 *   3. A `dfesTranslations`-sourced value re-typed with a mistake — the
 *      exact failure mode that shipped inverted word order once already.
 *      This is the same pattern `translationsSplit.test.ts` uses to guard
 *      the DFES split: an independent oracle, not a self-comparison.
 *   4. `resolveOversightString()` returning `''` instead of falling back
 *      to `en` — the one bug Ruling 7 explicitly asked to be tested for,
 *      because a blank label on a farmer's screen is worse than English.
 */
import { describe, it, expect } from 'vitest';

import { oversightTranslations, PENDING_FOUNDER_STRINGS, resolveOversightString } from '../oversightTranslations';
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

// Category (c), Controller Ruling 7 (original six) + Ruling 8 (two more,
// added by Task 5) — `mr` is '' by design, `en` is the only thing on screen
// until a founder supplies real Marathi.
const KEYLESS_BUT_DECLARED_KEYS: (keyof OversightTranslations)[] = [
    'talliesPeopleUnit',
    'plotsUnit',
    'seenControlHint',
    'retryAffordance',
    'bandDecisionsHeader',
    'bandSinceLastLookedHeader',
    'sinceLastLookedTail',
    'dayNotClosedLine',
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

    it('every en value is a non-empty string, for every key without exception', () => {
        for (const [key, value] of Object.entries(oversightTranslations.en)) {
            expect(typeof value, `en.${key} should be a string`).toBe('string');
            expect(value.length, `en.${key} should not be empty`).toBeGreaterThan(0);
        }
    });

    it('every mr value is a non-empty string, EXCEPT the six Ruling-7 keyless-but-declared keys', () => {
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(typeof value, `mr.${key} should be a string`).toBe('string');
            if (KEYLESS_BUT_DECLARED_KEYS.includes(key as keyof OversightTranslations)) {
                continue; // asserted empty, separately and explicitly, below
            }
            expect(value.length, `mr.${key} should not be empty`).toBeGreaterThan(0);
        }
    });

    it('the six Ruling-7 keys are mr: "" exactly — not whitespace, not a near-empty guess', () => {
        for (const key of KEYLESS_BUT_DECLARED_KEYS) {
            expect(oversightTranslations.mr[key], `mr.${key} should be the literal empty string`).toBe('');
        }
    });

    it('every non-Ruling-7 mr value contains Devanagari and every en value does not', () => {
        // The quietest way this module could go wrong: an English string
        // typed into the `mr` block (or vice versa) by accident. The
        // Ruling-7 keys are excluded from the mr half on purpose — '' has
        // no Devanagari by definition, and that is the correct value.
        const devanagari = /[ऀ-ॿ]/;
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            if (KEYLESS_BUT_DECLARED_KEYS.includes(key as keyof OversightTranslations)) {
                continue;
            }
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

    it('every spec §6.2 placeholder AND every Ruling-7 keyless-but-declared key is represented in PENDING_FOUNDER_STRINGS', () => {
        // `waitingLabel` and `restState` are both deliberately absent —
        // Task 13 graduated `waitingLabel` to founder-approved copy (his own
        // reference-image table), and a later founder message (2026-08-23)
        // graduated `restState` the same way, so neither must be flagged
        // pending any more. See oversightTranslations.ts's header, category
        // (d).
        const expectedPending = [
            'seenControl',
            'decisionLine',
            'delegatedLine',
            'failedSends',
            'recordBarIdle',
            'recordBarActive',
            ...KEYLESS_BUT_DECLARED_KEYS,
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

describe('oversightTranslations — pending_strings_render_english_when_marathi_is_empty', () => {
    it('resolveOversightString falls back to en for every Ruling-7 key when asked for mr', () => {
        for (const key of KEYLESS_BUT_DECLARED_KEYS) {
            const resolved = resolveOversightString('mr', key);
            expect(resolved, `resolveOversightString('mr', '${key}') must not be ''`).not.toBe('');
            expect(resolved).toBe(oversightTranslations.en[key]);
        }
    });

    it('resolveOversightString returns en directly when asked for en', () => {
        for (const key of KEYLESS_BUT_DECLARED_KEYS) {
            expect(resolveOversightString('en', key)).toBe(oversightTranslations.en[key]);
        }
    });

    it('resolveOversightString returns the real mr value for an ordinary (non-empty) key', () => {
        // Proves the helper is a fallback, not a blanket redirect to
        // English — an approved or placeholder Marathi string must still
        // win when it actually exists.
        expect(resolveOversightString('mr', 'welcomeBack')).toBe(oversightTranslations.mr.welcomeBack);
        expect(resolveOversightString('mr', 'waitingLabel')).toBe(oversightTranslations.mr.waitingLabel);
        expect(resolveOversightString('mr', 'restState')).toBe(oversightTranslations.mr.restState);
    });
});
