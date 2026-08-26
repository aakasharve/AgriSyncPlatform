/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope, D4
 *
 * The copy every harvest entry point shows INSTEAD of a sale/config form.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `features/logs/components/harvest/HarvestComingSoon.tsx` shipped in
 * ENGLISH ONLY, and said so in its own header ("English placeholder only —
 * the founder authors the final Marathi"). That was survivable while the app
 * opened in English. Commit `d1c3837d` made Marathi the default
 * (`i18n/LanguageContext.tsx`: the `useUiPref` fallback is `'mr'`, and an
 * unrecognised stored value also resolves to `'mr'`), so a Marathi-first
 * smallholder — the entire target user — now meets an English-only screen
 * whose middle sentence is the ONLY thing standing between him and a lost
 * sale record: a harvest sale typed here is never written anywhere. A
 * warning that cannot be read is not a warning, and `P5` ("a truthful
 * missing feature beats a fake working one") is not satisfied by a truthful
 * sentence in a language the reader does not have.
 *
 * WHY ITS OWN LEAF MODULE, NOT `translations.ts`
 * ----------------------------------------------
 * Same reason `approvalAvailabilityTranslations.ts` gives: `t()` in
 * `translations.ts` falls back to the KEY, not to English, when a value is
 * empty — a farmer would be shown the literal text `harvestUnavailableBody`.
 * This module carries its own resolver instead, so an unwritten string
 * degrades to readable English rather than to a label.
 *
 * THE MARATHI RULE (`oversightTranslations.ts`, "No agent may invent
 * farmer-facing Marathi")
 * -----------------------------------------------------------------------
 * Both `mr` values below are ASSEMBLED FROM ALREADY-SHIPPED, LOAD-BEARING
 * PHRASES rather than translated afresh. Every clause is cited to the file
 * and line it was transcribed from:
 *
 *   `शेतनोंदीत जाणार नाही` — VERBATIM, character for character, from
 *     `i18n/syncTranslations.ts:239` (`notFiledBadgeTail`; its `en` at `:227`
 *     is "will not reach your farm records"). This is the LOAD-BEARING
 *     clause, and it is deliberately the app's existing one: the farmer who
 *     reads it here has already met the same words on the save toast and the
 *     record badge, so it carries the meaning the app has already taught him
 *     rather than a synonym he has to decode.
 *     `__tests__/HarvestComingSoon.test.tsx` pins it against
 *     `syncTranslations` itself so the two cannot drift apart silently.
 *
 *   `आजून उपलब्ध नाहीये` — the founder's own words, from
 *     `i18n/approvalAvailabilityTranslations.ts:111`
 *     (`approvalUnavailableTitle`), INCLUDING his spelling `आजून` (not
 *     normalised to `अजून`). Reused whole because it is the phrase this app
 *     has already settled on for "a feature is not switched on yet", and
 *     because — like his — it promises no date (`P4`).
 *
 *   `कापणी` — `i18n/translations.ts:533` (`settings.harvestConfig` =
 *     `कापणी सेटिंग्ज`). The app's own word for harvest; the Settings row
 *     that renders this notice is titled with it.
 *
 *   `तयार नाही` — `features/sync/conflict/ConflictResolutionService.ts:192`
 *     (`सर्व्हरवर हा प्रकार अद्याप तयार नाही.`), the shipped sentence for
 *     "this is not built on our side yet".
 *
 *   `अॅपचा ... भाग` — `अॅप` from `i18n/consentTranslations.ts:69-70`;
 *     `भाग` ("part") from `shared/utils/marathiPrompts.ts:429`
 *     (`काही भाग समजला नाही`).
 *
 *   `नोंदवली` — `features/labour/components/HajeriLedger.tsx:32`
 *     (`अजून हजेरी नोंदवली नाही`) and `.../ReviewSheet.tsx:236`
 *     (`शंका नोंदवली`).
 *
 *   `फोनवरचं` — `फोनवर` is the app's word for "on the phone", 22 occurrences
 *     including `application/usecases/UpdateLog.ts:61` and
 *     `features/labour/components/ReviewSheet.tsx:189` (`फोनवर सेव्ह ✓`).
 *
 *   `मिटवलेलं नाही` — `मिटव-` from `i18n/consentTranslations.ts:66`
 *     (`... ३० दिवसांनंतर मिटवले जातात.`) and
 *     `i18n/dataRightsTranslations.ts:55` (`माझा डेटा मिटवा`). The colloquial
 *     `-लं` ending is this app's register, not a shortcut:
 *     `oversightTranslations`' `seenControl` is `मी हे पाहिलं` and
 *     `consentTranslations.ts:70` ends `... अधिक चांगलं होईल`.
 *
 * ONE WORD HAS NO IN-REPO PRECEDENT AND IS FLAGGED RATHER THAN PRESENTED AS
 * SETTLED: `विक्री` ("sale"). Nothing under `src/clients/` contains the root
 * at all — the harvest feature was built entirely in English. It is kept
 * because dropping it would soften the one fact that matters: what is lost
 * here is a SALE (quantity, grade, rate, patti, money), not a generic note,
 * and `कापणीची नोंद` on its own would let a farmer read the warning as being
 * about something smaller than it is. Listed in `FOUNDER_REVIEW_WORDS` below
 * so it is asked about rather than assumed.
 *
 * WHAT THE COPY MAY AND MAY NOT CLAIM (unchanged from the English —
 * `HarvestComingSoon.tsx`'s "FIX ROUND 1 CORRECTION" is the full trace)
 * -----------------------------------------------------------------------
 * Three facts, in this order, in both languages:
 *   1. this part of the app is not built yet;
 *   2. a harvest sale recorded here would NOT be saved to the farm records;
 *   3. nothing already on the phone has been deleted.
 * Fact 3 is the narrow, evidenced claim — this change reads, writes and
 * deletes nothing. It is NOT the claim fix round 1 struck out ("anything you
 * already noted down here is still on your phone"), which was false because
 * grade-wise sale data was never written by any code path in the first
 * place. The Marathi says `फोनवरचं काहीही मिटवलेलं नाही` — "nothing on the
 * phone has been deleted" — and, exactly like the English, says nothing
 * about what any past entry currently contains.
 *
 * No date is promised in either language (`P4`).
 */

import type { Language } from './language';

export interface HarvestAvailabilityTranslations {
    /**
     * Heading on the surface that stands where the harvest sale/config flow
     * used to be. Names the state of the FEATURE, never the state of the
     * records.
     */
    harvestUnavailableTitle: string;
    /**
     * The body line. Carries all three facts in the order above, with the
     * load-bearing one — a sale recorded here is not saved — in the middle
     * and in the app's own already-taught words (`शेतनोंदीत जाणार नाही` /
     * "will not reach your farm records").
     */
    harvestUnavailableBody: string;
}

export const harvestAvailabilityTranslations: Record<Language, HarvestAvailabilityTranslations> = {
    en: {
        // Both values are the strings that shipped inline at
        // `HarvestComingSoon.tsx:70-71`, moved here character for character.
        // They are NOT re-worded by this change: the English is the reviewed
        // copy of fix round 1, and re-opening it while adding Marathi would
        // put two edits in one diff.
        harvestUnavailableTitle: 'Harvest tracking is coming soon',
        harvestUnavailableBody:
            "This part of the app isn't built yet — a harvest sale recorded here would not be saved to your farm records. Nothing on your phone has been deleted.",
    },
    mr: {
        // Assembled from shipped phrases; every clause is cited in this
        // file's header. `आजून उपलब्ध नाहीये` is the founder's own line from
        // `approvalAvailabilityTranslations.ts:111`, his spelling included.
        harvestUnavailableTitle: 'कापणीची नोंद आजून उपलब्ध नाहीये',
        // Sentence 2 contains `शेतनोंदीत जाणार नाही` VERBATIM from
        // `syncTranslations.ts:239`. If that source line ever changes, the
        // pin in `__tests__/HarvestComingSoon.test.tsx` fails here.
        harvestUnavailableBody:
            'अॅपचा हा भाग आजून तयार नाही. इथे कापणीची विक्री नोंदवली तरी ती शेतनोंदीत जाणार नाही. तुमच्या फोनवरचं काहीही मिटवलेलं नाही.',
    },
};

/**
 * Every key in this module awaiting founder Marathi. EMPTY — both `mr`
 * values are real text, assembled from shipped phrases (see header). Kept
 * for the same reason `approvalAvailabilityTranslations`' copy is: it is the
 * contract the test checks the hollow set against, so "nothing is pending"
 * stays an asserted claim rather than an absence, and the next unwritten
 * string has somewhere to be listed.
 */
export const PENDING_FOUNDER_STRINGS: readonly (keyof HarvestAvailabilityTranslations)[] = [];

/**
 * Marathi words used above that have NO precedent anywhere under
 * `src/clients/`, and are therefore this module's judgement rather than the
 * app's settled vocabulary. Declared so the founder is asked about them
 * instead of having them presented as decided.
 */
export const FOUNDER_REVIEW_WORDS: readonly string[] = ['विक्री'];

/**
 * The one mechanical place an empty `mr` turns into readable text on screen.
 * Same shape and same reasoning as
 * `approvalAvailabilityTranslations.resolveApprovalAvailabilityString` and
 * `oversightTranslations.resolveOversightString` — a consuming component
 * never has to know which keys are hollow, and a hollow key renders English
 * rather than a blank label or a raw key name. Its fallback branch is
 * UNEXERCISED today (neither key is hollow); it stays so a future hollow key
 * is safe without touching a component.
 */
export function resolveHarvestAvailabilityString(
    language: Language,
    key: keyof HarvestAvailabilityTranslations,
): string {
    const value = harvestAvailabilityTranslations[language][key];
    if (value !== '') {
        return value;
    }
    return harvestAvailabilityTranslations.en[key];
}
