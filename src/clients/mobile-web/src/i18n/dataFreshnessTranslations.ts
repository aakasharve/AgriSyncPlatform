/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * ONE LINE: HOW RECENT THE WORK ON THIS SCREEN IS.
 *
 * FOUNDER DECISION, 2026-08-26, in his own words: *"one small chip inside
 * the oversight bar, last timing of the sync — not to mention sync as a
 * word — but in layman language it must show the app is up to date till,
 * let's say, 12am Tuesday. Please make sure you are connected to the
 * internet or something like that. Just a one line message to show him. Not
 * complicated."*
 *
 * THREE CONSTRAINTS THIS FILE EXISTS TO HOLD
 * ---------------------------------------------
 *
 *   1. THE WORD "SYNC" NEVER APPEARS, in either language, and neither does
 *      any Devanagari transliteration of it. `__tests__/
 *      dataFreshnessTranslations.test.ts` asserts that over every value in
 *      the table, so a future reword cannot reintroduce it.
 *
 *   2. IT STATES A FACT, NEVER A REASSURANCE. "Showing work up to Tuesday
 *      12:00" is a floor — everything the server held at that instant is on
 *      this phone, and locally-created work is on top of it. "Everything is
 *      up to date" is the claim that is FALSE the moment a sathi's record
 *      has not arrived yet, which is the whole defect this chip was asked
 *      for. So the copy below never says "up to date", never says "all", and
 *      never says "everything".
 *
 *   3. AN UNKNOWN TIME IS SAID OUT LOUD, NEVER REPLACED. `lastSyncAt` is
 *      `null` both before the first Dexie read and on a device that has
 *      never completed a pull (`features/sync/hooks/useSyncQueueStatus.ts`
 *      — `EMPTY_STATUS.lastSyncAt` is `null` and the `catch` leaves it
 *      alone). Both mean the same thing to a farmer — the app cannot state
 *      an up-to time — so both render `showingWorkUpToUnknown`. Falling back
 *      to the device clock, to "now", or to any invented instant would be a
 *      fabricated freshness claim, which is worse than the bug being fixed
 *      (doctrine `P4`).
 *
 * WHY ITS OWN MODULE AND NOT A KEY IN `oversightTranslations.ts`
 * ----------------------------------------------------------------
 * The same reason `approvalAvailabilityTranslations.ts` and
 * `harvestAvailabilityTranslations.ts` are their own modules: this is a
 * distinct copy concern with a long provenance record, and
 * `check:file-sizes` caps mobile-web source at 800 lines —
 * `oversightTranslations.ts` is close enough to that cap that folding this
 * documentation in would push it over. Same shape as those two: a `Record<
 * Language, …>` table, a `PENDING_FOUNDER_STRINGS` list, a
 * `FOUNDER_REVIEW_WORDS` list, and one `resolve…String()` that reads through
 * to English for a hollow `mr`.
 *
 * MARATHI PROVENANCE — every clause, cited
 * -------------------------------------------
 * No agent may invent farmer-facing Marathi (`oversightTranslations.ts`'s
 * Hard Rule, which governs this file too). Nothing below is a new sentence
 * lifted from nowhere; each clause is named with the shipped string it comes
 * from, and everything that is NOT a verbatim lift is listed in
 * `FOUNDER_REVIEW_WORDS` so the founder is ASKED rather than told.
 *
 *   `पर्यन्त`        — the founder's own spelling (not the more common
 *                     "पर्यंत"), VERBATIM from
 *                     `oversightTranslations.mr.restState`
 *                     ('आज पर्यन्त सर्व कामे पूर्ण आहेत') and
 *                     `.unsendableRecordsLine`. The genitive `पर्यन्तची`
 *                     ("of up-to") is an INFLECTION of his word — flagged.
 *   `कामे`          — VERBATIM `oversightTranslations.mr.entries`, the
 *                     word this feature already uses for a farmer's work.
 *                     Deliberately not `नोंदी`; see that file's header on
 *                     `failedSends`.
 *   `दिसत आहेत`     — `दिसत आहे` ships in
 *                     `shared/utils/marathiPrompts.ts:89`, and the
 *                     farmer-facing `दिसतं` in
 *                     `features/labour/components/LabourHub.tsx:239`. The
 *                     neuter-plural agreement for `कामे` is mine — flagged.
 *   `सांगता येत नाही` — VERBATIM from the founder's own
 *                     `oversightTranslations.mr.unknownState`
 *                     ('निश्चित सांगता येत नाही की सर्व कामे झाली'). The
 *                     unknown line below borrows the app's already-settled
 *                     way of admitting it cannot state something.
 *   `हे`            — VERBATIM from `oversightTranslations.mr.seenControl`
 *                     ('मी हे पाहिलं').
 *   `कधी`           — ships inside `कधीही` (`consentTranslations.ts:61`,
 *                     `voiceDiaryTranslations.ts:119`). The compound
 *                     `कधीपर्यन्तची` is mine — flagged.
 *   `आहे का`        — VERBATIM from the founder's own reference-image copy
 *                     `oversightTranslations.mr.helpTitle`
 *                     ('काही अडचण आहे का?'), and the same interrogative
 *                     `…का` he uses in `dfesTranslations.mr.closeToday`.
 *   `सुरू`          — VERBATIM from `translations.ts` mr
 *                     (`logPage.noLogsMessage` 'शेतातील कामांची नोंद सुरू करा',
 *                     `voice.startLogging` 'नोंद सुरू करा').
 *   `बघा`           — `बघू शकता` ships in
 *                     `approvalAvailabilityTranslations.ts:112`
 *                     ('इथे सगळं बघू शकता'). The imperative `बघा` is an
 *                     INFLECTION of it — flagged.
 *   `इंटरनेट`        — NO precedent anywhere under `src/clients/`. It is the
 *                     ordinary Marathi loanword and the founder asked for
 *                     the hint by name, but it is still this module's
 *                     judgement — flagged, and the first entry in
 *                     `FOUNDER_REVIEW_WORDS`.
 *   `आज` / `काल`    — VERBATIM from `translations.ts` mr `logPage.today`
 *                     ('आज') and `logPage.yesterday` ('काल'). Declared here
 *                     rather than imported, per the same no-cross-import
 *                     convention `oversightTranslations.navCompare` follows
 *                     for founder copy.
 *
 * THE CONNECTIVITY HINT IS A NECESSITY, NOT A PROMISE. "इंटरनेट सुरू आहे का
 * बघा" / "Check that your internet is on" says a connection is REQUIRED for
 * anything newer to arrive. It deliberately does not say that connecting
 * WILL bring newer work — nothing on this screen can know whether anything
 * newer exists, and a promise this code cannot keep is the `P5` failure the
 * unqueueable row was reworded to avoid.
 *
 * `खात्री करा` WAS CONSIDERED AND REJECTED for the hint, even though it is
 * the founder's own phrase for "make sure" (`dfesTranslations.mr.closeToday`,
 * `.verify`). In this app that phrase already means VERIFYING A RECORD — it
 * is `dfes.verify`'s entire label, and `oversightTranslations.ts`'s header
 * bans `खात्री` from `seenControl` for precisely that reason. Borrowing a
 * decision word for a connectivity hint would put a review verb on a line
 * that reviews nothing.
 */
import type { Language } from './language';

export interface DataFreshnessTranslations {
    /**
     * The chip, when an up-to instant is known. Template — `{when}`, filled
     * by `features/oversight/formatUpToWhen.ts` with a day label and a
     * farmer-readable time ('काल दुपारी 12:00' / 'Yesterday 12:00 PM'),
     * never with a raw ISO string and never with a fabricated time.
     */
    showingWorkUpTo: string;
    /**
     * The chip, when there is no up-to instant to state. Renders whenever
     * `lastSyncAt` is `null` OR unparseable — see constraint 3 in this
     * file's header. Carries the SAME connectivity hint as the known form,
     * so the farmer is told the one thing he can act on either way.
     */
    showingWorkUpToUnknown: string;
    /** `{when}`'s day label when the instant falls on today's IST date key. */
    dayToday: string;
    /** `{when}`'s day label when it falls on yesterday's IST date key. */
    dayYesterday: string;
}

export const dataFreshnessTranslations: Record<Language, DataFreshnessTranslations> = {
    en: {
        showingWorkUpTo: 'Showing work up to {when}. Check that your internet is on.',
        showingWorkUpToUnknown:
            'Cannot say up to when this is showing work. Check that your internet is on.',
        // `translations.ts` en `logPage.today` / `logPage.yesterday`,
        // transcribed rather than imported (see header).
        dayToday: 'Today',
        dayYesterday: 'Yesterday',
    },
    mr: {
        // Assembled from shipped clauses; every one is cited in this file's
        // header, and the three that are inflections rather than verbatim
        // lifts are listed in `FOUNDER_REVIEW_WORDS` below.
        showingWorkUpTo: '{when} पर्यन्तची कामे दिसत आहेत. इंटरनेट सुरू आहे का बघा.',
        showingWorkUpToUnknown: 'कामे कधीपर्यन्तची दिसत आहेत हे सांगता येत नाही. इंटरनेट सुरू आहे का बघा.',
        dayToday: 'आज',
        dayYesterday: 'काल',
    },
};

/**
 * Every key in this module awaiting founder Marathi. EMPTY — all four `mr`
 * values are real text assembled from shipped clauses (see header). Kept,
 * not deleted, for the same reason the sibling modules keep theirs: it is
 * the contract `__tests__/dataFreshnessTranslations.test.ts` checks the
 * hollow set against, so "nothing is pending" stays an asserted claim rather
 * than an absence.
 */
export const PENDING_FOUNDER_STRINGS: readonly (keyof DataFreshnessTranslations)[] = [];

/**
 * Marathi above that is this module's JUDGEMENT rather than the app's
 * settled vocabulary — either no precedent exists at all, or the precedent
 * exists in a different inflection. Declared so the founder is asked about
 * them instead of having them presented as decided. Same mechanism as
 * `harvestAvailabilityTranslations.FOUNDER_REVIEW_WORDS`.
 */
export const FOUNDER_REVIEW_WORDS: readonly string[] = [
    // No precedent anywhere under `src/clients/`.
    'इंटरनेट',
    // Inflections of shipped words — see the per-clause table in the header.
    'पर्यन्तची',
    'कधीपर्यन्तची',
    'दिसत आहेत',
    'बघा',
];

/**
 * The one mechanical place an empty `mr` turns into readable text on screen.
 * Same shape and same reasoning as
 * `oversightTranslations.resolveOversightString` — a consuming component
 * never has to know which keys are hollow, and a hollow key renders English
 * rather than a blank label. Its fallback branch is UNEXERCISED today (no
 * key is hollow); it stays so a future hollow key is safe without touching a
 * component.
 */
export function resolveDataFreshnessString(
    language: Language,
    key: keyof DataFreshnessTranslations,
): string {
    const value = dataFreshnessTranslations[language][key];
    if (value !== '') {
        return value;
    }
    return dataFreshnessTranslations.en[key];
}
