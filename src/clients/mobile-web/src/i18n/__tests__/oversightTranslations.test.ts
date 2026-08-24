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
 *
 * FINDING F7(b) — THE ORACLE NOW COVERS EVERY KEY, NOT TEN OF THEM
 * ------------------------------------------------------------------
 * `EXPECTED_GRADUATED_MR` pinned only the ten Group-A/B keys. Eighteen
 * other farmer-facing Marathi strings — `waitingLabel`, `restState`, and
 * the sixteen category-(d) keys the founder typed by his own hand
 * (`waitingSubtitle`, the three `nav*`, the five `guide*`, the two
 * `plotSection*`, the two `entireFarm*`, the three `help*`) — had NO
 * byte-pinning at all. A reworded or mistyped one would have compiled,
 * rendered and passed every test in this file.
 *
 * That oracle is replaced by `EXPECTED_MR` below: one literal per key, for
 * EVERY key. Two properties make it hard to defeat —
 *
 *   - it is typed `Record<keyof OversightTranslations, string>`, so adding
 *     a key to the interface without adding it here fails `tsc --noEmit`.
 *     Coverage is a COMPILE error, not a forgotten test.
 *   - it is a second, hand-written copy. Changing the module alone fails;
 *     changing both is a deliberate act with the founder's copy in the
 *     diff, which is the whole point.
 *
 * `EXPECTED_EN` pins only the two English values that make a CLAIM rather
 * than merely translate one — see its own comment. English is not
 * founder-gated, so the rest is left free.
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

// FINDING F7(b) — the eighteen founder-authored keys that had no
// byte-pinning before this change: `waitingLabel` and `restState` (each
// graduated by its own founder message) plus the sixteen category-(d) keys
// transcribed from his own reference-image table. Named as a group so the
// "these are his words, not ours" tests below can address them directly.
const FOUNDER_APPROVED_KEYS: (keyof OversightTranslations)[] = [
    'waitingLabel',
    'restState',
    'waitingSubtitle',
    'navToday',
    'navMyFarm',
    'navCompare',
    'guideGreeting',
    'guideHeadline',
    'guideLine1',
    'guideLine2',
    'guideLine3',
    'plotSectionHeader',
    'plotSectionHint',
    'entireFarmLabel',
    'entireFarmHint',
    'helpTitle',
    'helpSubtitle',
    'helpButtonLabel',
];

// Category (c) — keyless-but-declared: `mr: ''` BY DESIGN, the honest
// encoding of "the founder has not written this yet". Not a defect and not
// an oversight, so the "every mr value is non-empty" checks below except
// exactly these and then assert the opposite for them, rather than being
// weakened into a check that could pass for an accidental blank.
const KEYLESS_BUT_DECLARED_KEYS: (keyof OversightTranslations)[] = [
    'checkingState',
];

// THE ORACLE (finding F7(b)). One literal per key, for EVERY key —
// `Record<keyof OversightTranslations, string>` makes a missing entry a
// `tsc` error rather than a silently uncovered string. Hand-written as a
// second copy on purpose: the same independent-oracle defence
// `reused_repo_strings_match_dfesTranslations_exactly` uses for the
// dfesTranslations-sourced keys, extended to the whole module.
const EXPECTED_MR: Record<keyof OversightTranslations, string> = {
    // (a) reused verbatim — also cross-checked against dfesTranslations.ts
    // itself by `reused_repo_strings_match_dfesTranslations_exactly`.
    welcomeBack: 'पुन्हा स्वागत! शेतात काय चाललं?',
    weeklyReviewPrompt: 'तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.',
    farmBookOpen: 'या आठवड्याची शेतनोंद उघडी आहे.',
    todayClosed: 'आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या',
    needsReview: 'तपासायचे आहे',
    unknown: 'अज्ञात',
    activitiesLogged: 'कामे नोंदवली',
    entries: 'कामे',

    // (a) reused from FarmContextSwitcher.tsx / AttentionPage.tsx.
    yourFarms: 'तुमच्या शेती',
    createFarm: 'शेती तयार करा',
    joinByQr: 'QR ने जोडा',
    attention: 'लक्ष द्या',
    allFarmsOnTrack: 'सगळ्या शेती आज व्यवस्थित आहेत',

    // (d) founder-approved — his own words. F7(b): unpinned until now.
    waitingLabel: 'तुमच्यासाठी बाकी',
    restState: 'आज पर्यन्त सर्व कामे पूर्ण आहेत',

    // (c) keyless-but-declared — '' is the value, deliberately.
    checkingState: '',

    // (b) spec §6.2 placeholders, still pending the founder.
    seenControl: 'मी हे पाहिलं',
    recordBarIdle: 'आधी प्लॉट निवडा',
    recordBarActive: 'बोला',
    delegatedLine: '{count} कामे — {name} ठरवतील',

    // Group B — reworded to final founder copy 2026-08-23.
    decisionLine: '{count} कामे तपासायची आहेत',
    failedSends: '{count} कामे अडकली आहेत — मी मदत करतो',

    // Group A — graduated out of `mr: ''` 2026-08-23.
    talliesPeopleUnit: 'माणसं',
    plotsUnit: 'प्लॉट',
    seenControlHint: 'यानं फक्त ‘पाहिलं’ एवढंच कळतं — मंजुरी मिळत नाही.',
    retryAffordance: 'पुन्हा पाठवा',
    bandDecisionsHeader: 'तुम्ही ठरवायचं आहे',
    bandSinceLastLookedHeader: 'तुम्ही शेवटचं पाहिल्यानंतर',
    sinceLastLookedTail: 'तुम्ही शेवटचं पाहिल्यानंतर — {days} दिवस',
    dayNotClosedLine: 'काल दिवस पूर्ण झाला नाही',

    // (d) founder-approved, Task 13/17 reference table. F7(b): unpinned
    // until now — every one of these is a sentence he typed himself.
    navToday: 'आजची कामे',
    navMyFarm: 'माझं शेत',
    navCompare: 'तुलना',
    waitingSubtitle: 'काही राहिलेल्या कामांकडे तुमचे लक्ष देणे गरजेचे आहे',
    guideGreeting: 'नमस्कार!',
    guideHeadline: 'आज कोणत्या प्लॉटवर काम केलं?',
    guideLine1: 'एक किंवा अनेक प्लॉट निवडा.',
    guideLine2: 'एकाच कामासाठी एकापेक्षा जास्त प्लॉट निवडू शकता.',
    guideLine3: 'काम प्लॉटशी संबंधित नसेल, तरच खाली ‘संपूर्ण शेत’ निवडा.',
    plotSectionHeader: 'प्लॉट निवडा',
    plotSectionHint: 'एकापेक्षा जास्त प्लॉट निवडू शकता',
    entireFarmLabel: 'संपूर्ण शेत',
    entireFarmHint: 'प्लॉटनुसार सांगता येत नसेल तेव्हा निवडा',
    helpTitle: 'काही अडचण आहे का?',
    helpSubtitle: 'मी मदत करतो.',
    helpButtonLabel: 'श्रम साथीशी बोला',
};

// English is NOT founder-gated, so it is deliberately left unpinned —
// except for the two values that make a CLAIM instead of translating one.
//
// `restState` is finding F7's English reconciliation: it read "Nothing
// waiting" while the founder's Marathi in the same slot says work is
// COMPLETE. One key, two languages, two different statements — an
// English-reading user and a Marathi-reading user were told different
// things by the same line. `checkingState` is the state that must exist so
// neither of them is told either thing before the data is read.
const EXPECTED_EN: Partial<Record<keyof OversightTranslations, string>> = {
    restState: 'All work is complete as of today',
    checkingState: 'Checking…',
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

    it('every mr value is a non-empty string, except the keyless-but-declared ones', () => {
        // Category (c) keys (`mr: ''`) are the ONE legitimate exception —
        // the honest encoding of "the founder has not written this yet".
        // They are excepted by NAME, and the test immediately below asserts
        // the opposite for them, so an accidental blank on any other key
        // still fails here and a category (c) key that quietly acquired
        // agent-written Marathi fails there.
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(typeof value, `mr.${key} should be a string`).toBe('string');
            if (KEYLESS_BUT_DECLARED_KEYS.includes(key as keyof OversightTranslations)) continue;
            expect(value.length, `mr.${key} should not be empty`).toBeGreaterThan(0);
        }
    });

    it('every keyless-but-declared key is EXACTLY empty and flagged pending', () => {
        // The other half of the exception above. `mr: ''` is a claim in
        // itself — "no agent wrote Marathi here" — so it is asserted, not
        // merely tolerated. Whitespace would defeat
        // `resolveOversightString`'s `!== ''` check and put a blank label on
        // a farmer's screen, which is the one outcome Ruling 7 named.
        for (const key of KEYLESS_BUT_DECLARED_KEYS) {
            expect(oversightTranslations.mr[key], `mr.${key} must be exactly ''`).toBe('');
            expect(
                PENDING_FOUNDER_STRINGS.includes(key),
                `${key} has no Marathi and must be flagged for the founder`,
            ).toBe(true);
        }
    });

    it('every mr value contains Devanagari and every en value does not', () => {
        // The quietest way this module could go wrong: an English string
        // typed into the `mr` block (or vice versa) by accident. The
        // keyless-but-declared keys are excepted for the same reason as
        // above — `''` has no Devanagari by definition, and the test above
        // is what pins them.
        const devanagari = /[ऀ-ॿ]/;
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            if (KEYLESS_BUT_DECLARED_KEYS.includes(key as keyof OversightTranslations)) continue;
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

    it('exactly the five still-unresolved keys are in PENDING_FOUNDER_STRINGS', () => {
        // `waitingLabel` and `restState` are absent — Task 13 graduated
        // `waitingLabel` to founder-approved copy (his own reference-image
        // table), and a later founder message (2026-08-23) graduated
        // `restState` the same way. As of the SAME 2026-08-23 message,
        // Group A (the eight ex-Ruling-7/8 keyless keys) and Group B
        // (`decisionLine`, `failedSends`) are ALSO absent — see
        // oversightTranslations.ts's header, "OVERSIGHT-LOOP STRING
        // GRADUATION".
        //
        // `checkingState` (finding F7) is the fifth: a new category (c) key
        // shipped with `mr: ''` rather than inventing Marathi for the
        // canonical strip's "still reading the data" state. This list held
        // exactly four before that change — the count is asserted here so
        // an addition is always deliberate and always reported.
        const expectedPending = [
            'seenControl',
            'delegatedLine',
            'recordBarIdle',
            'recordBarActive',
            'checkingState',
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

describe('oversightTranslations — every_mr_value_is_byte_pinned (finding F7b)', () => {
    it('every_declared_key_has_a_byte_pinned_mr_value', () => {
        // The whole module, not a subset. `EXPECTED_MR` is typed
        // `Record<keyof OversightTranslations, string>`, so a key added to
        // the interface without a literal here fails `tsc --noEmit` — this
        // test then proves the literal is the one actually shipping.
        for (const key of Object.keys(oversightTranslations.mr) as (keyof OversightTranslations)[]) {
            expect(
                oversightTranslations.mr[key],
                `mr.${key} drifted from the pinned copy — if this was intentional, the founder's words changed and the oracle must be updated with them`,
            ).toBe(EXPECTED_MR[key]);
        }
    });

    it('the oracle and the module declare exactly the same key set', () => {
        // `tsc` guards additions to the INTERFACE; this guards the runtime
        // object literals against a key present in one and not the other
        // (e.g. added behind an `as` cast, or removed from `mr` only).
        expect(Object.keys(EXPECTED_MR).sort()).toEqual(Object.keys(oversightTranslations.mr).sort());
    });

    it('the_eighteen_founder_authored_strings_are_pinned_and_never_flagged_pending', () => {
        // Finding F7(b) named these explicitly: `waitingLabel`, `restState`
        // and the sixteen category-(d) keys the founder typed himself. They
        // had no byte-pinning at all before this change, so a reword would
        // have shipped silently. Asserted as a group, by name, so deleting
        // one from the oracle is visible in a diff.
        expect(FOUNDER_APPROVED_KEYS).toHaveLength(18);
        for (const key of FOUNDER_APPROVED_KEYS) {
            expect(oversightTranslations.mr[key], `mr.${key} drifted from the founder's own words`).toBe(EXPECTED_MR[key]);
            expect(oversightTranslations.mr[key].length, `mr.${key} must not be empty`).toBeGreaterThan(0);
            expect(
                PENDING_FOUNDER_STRINGS.includes(key),
                `${key} is the founder's own copy and must not be flagged pending`,
            ).toBe(false);
        }
    });

    it('the_english_rest_state_makes_the_same_claim_as_the_founders_marathi', () => {
        // Finding F7. `en.restState` used to read "Nothing waiting" while
        // the Marathi beside it asserted that all work is COMPLETE — the
        // same key telling two users two different things. The Marathi is
        // founder-authored and untouched; the English moved to match it.
        for (const [key, value] of Object.entries(EXPECTED_EN)) {
            expect(oversightTranslations.en[key as keyof OversightTranslations]).toBe(value);
        }
        expect(oversightTranslations.en.restState).not.toBe('Nothing waiting');
    });
});

describe('oversightTranslations — GROUP A & GROUP B, founder-approved 2026-08-23', () => {
    it('every Group A / Group B mr value is byte-identical to the founder\'s table', () => {
        for (const key of [...GROUP_A_GRADUATED_KEYS, ...GROUP_B_REWORDED_KEYS]) {
            expect(oversightTranslations.mr[key], `mr.${key} drifted from the founder's ruled copy`).toBe(EXPECTED_MR[key]);
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

    it('a_keyless_but_declared_key_reads_through_to_english_never_a_blank_label', () => {
        // Ruling 7's original ask, load-bearing again as of finding F7:
        // `checkingState` ships `mr: ''`, so this is the code path that
        // decides between an English sentence a farmer can read and an
        // empty label he cannot. It must never return `''`.
        for (const key of KEYLESS_BUT_DECLARED_KEYS) {
            const resolved = resolveOversightString('mr', key);
            expect(resolved, `resolveOversightString('mr', '${key}') must not be blank`).not.toBe('');
            expect(resolved).toBe(oversightTranslations.en[key]);
        }
    });
});
