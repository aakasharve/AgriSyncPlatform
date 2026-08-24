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
 *
 * 2026-08-24 — THE MODULE HAS NO HOLLOW KEYS LEFT, AND TWO FEWER KEYS
 * ---------------------------------------------------------------------
 * The founder ruled on the last three `mr: ''` keys (`checkingState`,
 * `unknownState`, `unsendableRecordsLine`) and DELETED two others
 * (`recordBarIdle`, `recordBarActive` — the reverted record bar's labels,
 * commit `ae8be8a1`). Consequences for this file, each one deliberate:
 *
 *   - `KEYLESS_BUT_DECLARED_KEYS` is now EMPTY. The tests that used it are
 *     rewritten to assert the SET of hollow keys equals that empty list,
 *     rather than looping over it — a loop over an empty array is a test
 *     that cannot fail, which is worth nothing.
 *   - `EXPECTED_MR` loses two entries and gains three real literals. It is
 *     still `Record<keyof OversightTranslations, string>`, so a key deleted
 *     from the interface but left here is a `tsc` error, exactly as an
 *     added-but-unpinned key is.
 *   - `PENDING_FOUNDER_STRINGS` is down to two: `seenControl` and
 *     `delegatedLine`.
 */
import { describe, it, expect } from 'vitest';

import { oversightTranslations, PENDING_FOUNDER_STRINGS, resolveOversightString } from '../oversightTranslations';
import type { OversightTranslations } from '../oversightTranslations';
// The ONE substitution helper every `{count}` template in this module is
// rendered through. Imported so the 2026-08-24 token correction is proven
// against the real substituter, not a re-implementation of it here.
import { formatOversightTemplate } from '../../features/oversight/formatOversightTemplate';
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

// The keys whose `mr` is `''` BY DESIGN — category (c), the honest encoding
// of "the founder has not written this yet".
//
// EMPTY as of 2026-08-24: `checkingState`, `unknownState` and
// `unsendableRecordsLine` were the last three, and the founder ruled on all
// three (see `oversightTranslations.ts`'s header, "THE LAST THREE (c) KEYS
// GRADUATE"). The list is KEPT rather than deleted because the tests below
// compare the module's ACTUAL hollow set against it — so "nothing is
// hollow" is an assertion, not an absence, and an accidental blank on any
// key fails immediately.
const KEYLESS_BUT_DECLARED_KEYS: (keyof OversightTranslations)[] = [];

// The three keys the founder ruled on 2026-08-24, graduating out of
// `mr: ''`. Named as a group so the byte-pinning below addresses them
// directly, the way Groups A and B are addressed.
const GRADUATED_2026_08_24_KEYS: (keyof OversightTranslations)[] = [
    'checkingState',
    'unknownState',
    'unsendableRecordsLine',
];

// The two keys DELETED in the same founder message — the reverted record
// bar's labels (`ae8be8a1`). Asserted as absent, by name, because "leaving
// dead keys is how a future agent rebuilds the thing he just removed": a
// silent re-addition would otherwise only be caught by a human reading the
// diff. `as string[]` because these are no longer `keyof
// OversightTranslations` — that is the point of the test.
const DELETED_2026_08_24_KEYS: string[] = ['recordBarIdle', 'recordBarActive'];

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

    // (d) founder-approved 2026-08-24 — the last three ex-`mr: ''` keys.
    // `unsendableRecordsLine` carries the `{count}` token
    // `formatOversightTemplate` substitutes; the founder wrote `{counts }`,
    // which matches no token and would have printed those nine characters
    // to a farmer. Token corrected, space moved outside the braces, not one
    // Devanagari character changed.
    checkingState: 'तपासात आहे',
    unknownState: 'निश्चित सांगता येत नाही की सर्व कामे झाली',
    unsendableRecordsLine: '{count} श्रम सफल पर्यन्त पोहचू शकले नाहीत',

    // (b) spec §6.2 placeholders, still pending the founder.
    seenControl: 'मी हे पाहिलं',
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
//
// `unknownState` (change 2) is pinned for the same reason as those two: it
// is the strip's third statement about the same fact, and the three must
// stay mutually consistent — "complete" / "still reading" / "cannot say".
// It is also the string a Marathi-reading farmer actually sees today, since
// its `mr` is deliberately empty and reads through to this value.
const EXPECTED_EN: Partial<Record<keyof OversightTranslations, string>> = {
    restState: 'All work is complete as of today',
    checkingState: 'Checking…',
    unknownState: 'Cannot confirm all work is done',
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
        // They are excepted by NAME, and the test immediately below pins the
        // exception list against the module's ACTUAL hollow set, so an
        // accidental blank on any other key still fails here.
        //
        // 2026-08-24: that list is empty, so this now asserts every single
        // `mr` value is real text.
        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(typeof value, `mr.${key} should be a string`).toBe('string');
            if (KEYLESS_BUT_DECLARED_KEYS.includes(key as keyof OversightTranslations)) continue;
            expect(value.length, `mr.${key} should not be empty`).toBeGreaterThan(0);
        }
    });

    it('the hollow keys are EXACTLY the declared keyless-but-declared ones — no more, no fewer', () => {
        // The other half of the exception above, written as a SET equality
        // rather than a loop. As of 2026-08-24 `KEYLESS_BUT_DECLARED_KEYS`
        // is empty, and a loop over an empty array is a test that cannot
        // fail; this shape keeps failing usefully in both directions —
        // a key that quietly went blank, and a declared-hollow key that
        // quietly acquired agent-written Marathi.
        //
        // `=== ''` and not `.trim() === ''` on purpose: whitespace would
        // defeat `resolveOversightString`'s own `!== ''` check and put a
        // blank label on a farmer's screen, so a whitespace-only value is a
        // defect that must surface as a NON-hollow key here and then fail
        // the non-empty check above... which it would not. So it is caught
        // explicitly instead.
        const hollow = (Object.keys(oversightTranslations.mr) as (keyof OversightTranslations)[])
            .filter((key) => oversightTranslations.mr[key] === '');
        expect([...hollow].sort()).toEqual([...KEYLESS_BUT_DECLARED_KEYS].sort());

        for (const [key, value] of Object.entries(oversightTranslations.mr)) {
            expect(value.trim() === '' && value !== '', `mr.${key} is whitespace-only`).toBe(false);
        }

        // Anything hollow must also be flagged for the founder.
        for (const key of hollow) {
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

    it('exactly the two still-unresolved keys are in PENDING_FOUNDER_STRINGS', () => {
        // Down from seven, in one founder message dated 2026-08-24: three
        // keys graduated (`checkingState`, `unknownState`,
        // `unsendableRecordsLine` — he supplied the Marathi) and two were
        // DELETED outright (`recordBarIdle`, `recordBarActive` — the
        // reverted record bar's labels, `ae8be8a1`).
        //
        // What is left is exactly the two spec §6.2 (b) placeholders he was
        // never asked about: `seenControl` and `delegatedLine`. Both already
        // carry the spec table's Devanagari, so neither is blank — they are
        // pending APPROVAL, not pending WORDS.
        //
        // The count is asserted as an exact set so that both directions are
        // caught: a key added back without a ruling, and a key quietly
        // dropped from the founder's queue without one either.
        const expectedPending = [
            'seenControl',
            'delegatedLine',
        ];
        expect([...PENDING_FOUNDER_STRINGS].sort()).toEqual(expectedPending.sort());
    });

    it('no key the founder ruled on 2026-08-24 is ever flagged pending again', () => {
        for (const key of GRADUATED_2026_08_24_KEYS) {
            expect(
                PENDING_FOUNDER_STRINGS.includes(key),
                `${key} is the founder's own copy and must not be pending`,
            ).toBe(false);
        }
    });

    it('the_deleted_record_bar_keys_never_come_back', () => {
        // The record bar was reverted at the founder's instruction
        // (`ae8be8a1`) and he ruled that its two labels be deleted, not
        // commented out — "leaving dead keys is how a future agent rebuilds
        // the thing he just removed". Absence is asserted at every place a
        // key can hide: both language literals, the pending list, and the
        // byte-pinning oracle.
        for (const key of DELETED_2026_08_24_KEYS) {
            expect(Object.keys(oversightTranslations.mr), `mr still declares ${key}`).not.toContain(key);
            expect(Object.keys(oversightTranslations.en), `en still declares ${key}`).not.toContain(key);
            expect([...PENDING_FOUNDER_STRINGS], `${key} is still flagged pending`).not.toContain(key);
            expect(Object.keys(EXPECTED_MR), `the oracle still pins ${key}`).not.toContain(key);
        }
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

describe('oversightTranslations — the last three (c) keys, founder-approved 2026-08-24', () => {
    it('every 2026-08-24 mr value is byte-identical to the founder\'s message', () => {
        for (const key of GRADUATED_2026_08_24_KEYS) {
            expect(oversightTranslations.mr[key], `mr.${key} drifted from the founder's ruled copy`).toBe(EXPECTED_MR[key]);
            expect(oversightTranslations.mr[key].length, `mr.${key} must not be empty any more`).toBeGreaterThan(0);
        }
    });

    it('restState and unknownState keep his spelling पर्यन्त / आजून untouched', () => {
        // His spelling, not the more common "पर्यंत". Normalising it would
        // be the exact "correction" the Hard Rule forbids, and it is the
        // kind of edit a spell-checking agent makes without noticing.
        expect(oversightTranslations.mr.restState).toContain('पर्यन्त');
        expect(oversightTranslations.mr.unsendableRecordsLine).toContain('पर्यन्त');
        expect(oversightTranslations.mr.unsendableRecordsLine).not.toContain('पर्यंत');
    });

    it('unknownState still names only the outcome, never either cause', () => {
        // The wording is load-bearing: ONE key carries two different
        // situations — a read that never finished, and a multi-farm account
        // whose completion claim has no statable subject
        // (`CanonicalStrip.tsx`'s `farmCount` prop doc). Naming either cause
        // would make the line false for the other. The founder's Marathi
        // keeps that property; these assertions stop a future "clarifying"
        // reword from breaking it.
        const mr = oversightTranslations.mr.unknownState;
        expect(mr).not.toContain('शेत');      // no farm/scope named
        expect(mr).not.toContain('चूक');      // not phrased as a fault
        expect(mr).not.toContain('इंटरनेट');  // no cause named
    });

    it('unsendableRecordsLine substitutes a real count and never promises a retry', () => {
        // The token is what `formatOversightTemplate` splits on. The
        // founder wrote `{counts }`; that matches no token, so a farmer
        // would have read the characters `{counts }` where his record count
        // belongs. Pinned as `{count}` here, and exercised end-to-end by
        // `AppHeader.oversight.test.tsx`'s
        // `the_unqueueable_row_never_borrows_the_failed_send_promise_of_a_retry`.
        const mr = oversightTranslations.mr.unsendableRecordsLine;
        expect(mr).toContain('{count}');
        expect(mr).not.toContain('{counts');
        expect(formatOversightTemplate(mr, { count: 2 })).toBe('2 श्रम सफल पर्यन्त पोहचू शकले नाहीत');
        // Finding F6's constraint, re-proven against the new copy: nothing
        // will ever send these records, so the row may not borrow
        // `failedSends`' promise of help.
        expect(mr).not.toContain('मी मदत करतो');
        expect(mr).not.toContain('अडकली');
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

    it('resolveOversightString never returns a blank label, for any key, in either language', () => {
        // Ruling 7's original ask, restated so it survives the 2026-08-24
        // graduation. It used to loop over `KEYLESS_BUT_DECLARED_KEYS` and
        // assert the English fallback; that list is now empty, and a loop
        // over an empty array asserts nothing. So the property is stated
        // over EVERY key instead — a blank label on a farmer's screen is the
        // outcome Ruling 7 named, and it is forbidden whether it arrives via
        // a hollow `mr`, a hollow `en`, or a future key that is both.
        for (const language of LANGUAGES) {
            for (const key of Object.keys(oversightTranslations.mr) as (keyof OversightTranslations)[]) {
                const resolved = resolveOversightString(language, key);
                expect(resolved, `resolveOversightString('${language}', '${key}') must not be blank`).not.toBe('');
            }
        }
    });

    it('no key reads through to English any more — every mr value is real text', () => {
        // The other half, and the one that would catch a silent regression
        // to `mr: ''`. As of 2026-08-24 the fallback branch is unexercised:
        // asking for 'mr' returns the Marathi, for every single key.
        for (const key of Object.keys(oversightTranslations.mr) as (keyof OversightTranslations)[]) {
            expect(
                resolveOversightString('mr', key),
                `resolveOversightString('mr', '${key}') fell back to English — a key went hollow`,
            ).toBe(oversightTranslations.mr[key]);
        }
    });
});
