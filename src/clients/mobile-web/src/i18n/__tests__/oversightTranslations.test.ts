/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guards for `oversightTranslations.ts` — see that file's header for the
 * Hard Rule this module exists to enforce (spec §6, "no agent may invent
 * farmer-facing Marathi").
 *
 * GRADUATION, 2026-08-23 (see `oversightTranslations.ts`'s "OVERSIGHT-LOOP
 * STRING GRADUATION" header section): Controller Ruling 7's original six
 * "keyless-but-declared" keys and Ruling 8's two more (added by Task 5 /
 * `WaitingDrawer`) all graduated out of `mr: ''` on this date — every one
 * now carries real founder Marathi. Two more already-placeholder keys
 * (`decisionLine`, `failedSends`) were reworded to their final founder copy
 * the same day. `GROUP_A_GRADUATED_KEYS` / `GROUP_B_REWORDED_KEYS` below
 * name the ten; the tests that used to assert `mr: ''` for the first eight
 * now assert the opposite — real, byte-pinned Marathi.
 *
 * Failure modes covered, one test group each:
 *
 *   1. A key with an `mr` but no `en` (or vice versa) — silently breaks
 *      the "render the placeholder beside its English fallback" contract
 *      spec §6.2 requires for every still-pending string.
 *   2. `PENDING_FOUNDER_STRINGS` naming a key that does not exist — the
 *      easy way for that list to drift from the module it flags.
 *   3. A `dfesTranslations`-sourced value re-typed with a mistake — the
 *      exact failure mode that shipped inverted word order once already.
 *      This is the same pattern `translationsSplit.test.ts` uses to guard
 *      the DFES split: an independent oracle, not a self-comparison.
 *   4. `resolveOversightString()` returning `''` instead of falling back
 *      to `en` — the one bug Ruling 7 explicitly asked to be tested for,
 *      because a blank label on a farmer's screen is worse than English.
 *      No key currently exercises the `''` branch (all graduated), so this
 *      group now pins the opposite: none of the ten 2026-08-23 keys ever
 *      falls back to English any more.
 *   5. The ten 2026-08-23 keys' `mr` values drifting from the founder's
 *      exact table — pinned byte-for-byte, independent of every consuming
 *      component.
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

// GROUP A — the eight ex-Ruling-7/8 keyless-but-declared keys, graduated to
// founder-approved copy 2026-08-23. Formerly `mr: ''`; now real Marathi,
// pinned byte-for-byte in EXPECTED_GRADUATED_MR below.
const GROUP_A_GRADUATED_KEYS: (keyof OversightTranslations)[] = [
    'talliesPeopleUnit',
    'plotsUnit',
    'bandDecisionsHeader',
    'bandSinceLastLookedHeader',
    'sinceLastLookedTail',
    'dayNotClosedLine',
    'seenControlHint',
    'retryAffordance',
];

// GROUP B — two already-approved (b) templates reworded to their final
// founder copy the same day (2026-08-23). Pinned in EXPECTED_GRADUATED_MR
// alongside Group A.
const GROUP_B_REWORDED_KEYS: (keyof OversightTranslations)[] = [
    'decisionLine',
    'failedSends',
];

// The founder's exact table, transcribed here as an independent oracle
// (same defence `reused_repo_strings_match_dfesTranslations_exactly` uses
// for the dfesTranslations-sourced keys below) so a future edit to
// `oversightTranslations.ts` cannot silently drift from what he actually
// ruled.
const EXPECTED_GRADUATED_MR: Record<string, string> = {
    talliesPeopleUnit: 'माणसं',
    plotsUnit: 'प्लॉट',
    bandDecisionsHeader: 'तुम्ही ठरवायचं आहे',
    bandSinceLastLookedHeader: 'तुम्ही शेवटचं पाहिल्यानंतर',
    sinceLastLookedTail: 'तुम्ही शेवटचं पाहिल्यानंतर — {days} दिवस',
    dayNotClosedLine: 'काल दिवस पूर्ण झाला नाही',
    seenControlHint: 'यानं फक्त ‘पाहिलं’ एवढंच कळतं — मंजुरी मिळत नाही.',
    retryAffordance: 'पुन्हा पाठवा',
    decisionLine: '{count} कामे तपासायची आहेत',
    failedSends: '{count} कामे अडकली आहेत — मी मदत करतो',
};

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

    it('every mr value is a non-empty string, for every key without exception', () => {
        // As of 2026-08-23 every ex-Ruling-7/8 key graduated to real
        // founder Marathi (see oversightTranslations.ts's header,
        // "OVERSIGHT-LOOP STRING GRADUATION") — no key in this module
        // currently carries `mr: ''`, so this is now a blanket check, the
        // same shape as the `en` check directly above.
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(typeof value, `mr.${key} should be a string`).toBe('string');
            expect(value.length, `mr.${key} should not be empty`).toBeGreaterThan(0);
        }
    });

    it('every mr value contains Devanagari and every en value does not', () => {
        // The quietest way this module could go wrong: an English string
        // typed into the `mr` block (or vice versa) by accident. No
        // exceptions any more — the ex-Ruling-7/8 keys' `mr: ''` (which had
        // no Devanagari by definition) is gone.
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

    it('exactly the four still-unresolved keys are in PENDING_FOUNDER_STRINGS', () => {
        // `waitingLabel` and `restState` are absent — Task 13 graduated
        // `waitingLabel` to founder-approved copy (his own reference-image
        // table), and a later founder message (2026-08-23) graduated
        // `restState` the same way. As of the SAME 2026-08-23 message,
        // Group A (the eight ex-Ruling-7/8 keyless keys) and Group B
        // (`decisionLine`, `failedSends`) are ALSO absent — see
        // oversightTranslations.ts's header, "OVERSIGHT-LOOP STRING
        // GRADUATION". Only these four remain unresolved.
        const expectedPending = [
            'seenControl',
            'delegatedLine',
            'recordBarIdle',
            'recordBarActive',
        ];
        expect([...PENDING_FOUNDER_STRINGS].sort()).toEqual(expectedPending.sort());
    });

    it('no Group A or Group B (2026-08-23 graduated) key is ever flagged pending', () => {
        for (const key of [...GROUP_A_GRADUATED_KEYS, ...GROUP_B_REWORDED_KEYS]) {
            expect(PENDING_FOUNDER_STRINGS.includes(key), `${key} is founder-approved copy and must not be pending`).toBe(false);
        }
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

describe('oversightTranslations — GROUP A & GROUP B, founder-approved 2026-08-23', () => {
    it('every Group A / Group B mr value is byte-identical to the founder\'s table', () => {
        for (const key of [...GROUP_A_GRADUATED_KEYS, ...GROUP_B_REWORDED_KEYS]) {
            expect(oversightTranslations.mr[key], `mr.${key} drifted from the founder's ruled copy`).toBe(EXPECTED_GRADUATED_MR[key]);
        }
    });

    it('dayNotClosedLine uses पूर्ण, never बंद (commit c66d1817 — the बंद metaphor is banned everywhere)', () => {
        expect(oversightTranslations.mr.dayNotClosedLine).toContain('पूर्ण');
        expect(oversightTranslations.mr.dayNotClosedLine).not.toContain('बंद');
    });

    it('failedSends uses कामे per this specific founder ruling — NOT a resolution of the general नोंदी/कामे question (open question #1, shram-sathi-FINAL-strings.md; see commit 06797135)', () => {
        // This assertion pins ONLY this key's exact, founder-supplied copy.
        // It must never be read as license to change any other first-person
        // Sathi line (e.g. `closeToday` in dfesTranslations.ts) by inference.
        expect(oversightTranslations.mr.failedSends).toContain('कामे');
        expect(oversightTranslations.mr.failedSends).not.toContain('नोंदी');
    });
});

describe('oversightTranslations — the Seen control never implies a decision (spec §P-G, §6.2)', () => {
    it('seenControl carries neither मंजूर (approve) nor खात्री (confirm)', () => {
        expect(oversightTranslations.mr.seenControl).not.toContain('मंजूर');
        expect(oversightTranslations.mr.seenControl).not.toContain('खात्री');
    });
});

describe('oversightTranslations — graduated_group_a_and_b_strings_never_fall_back_to_english', () => {
    it('resolveOversightString returns the real (graduated) mr value for every Group A / Group B key, never the en fallback', () => {
        // Opposite of the pre-2026-08-23 behaviour: these ten keys used to
        // be `mr: ''` (Group A) or already real (Group B) — now ALL ten
        // carry real founder Marathi, so asking for 'mr' must never read
        // through to English any more.
        for (const key of [...GROUP_A_GRADUATED_KEYS, ...GROUP_B_REWORDED_KEYS]) {
            const resolved = resolveOversightString('mr', key);
            expect(resolved, `resolveOversightString('mr', '${key}') should be the real mr value`).toBe(oversightTranslations.mr[key]);
            if (oversightTranslations.mr[key] !== oversightTranslations.en[key]) {
                expect(resolved, `resolveOversightString('mr', '${key}') should not silently fall back to en`).not.toBe(oversightTranslations.en[key]);
            }
        }
    });

    it('resolveOversightString returns en directly when asked for en', () => {
        for (const key of [...GROUP_A_GRADUATED_KEYS, ...GROUP_B_REWORDED_KEYS]) {
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
