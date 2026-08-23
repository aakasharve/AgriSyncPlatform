/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Owner's Oversight Loop copy — the canonical strip (`AppHeader`) and the
 * waiting drawer. Spec: `docs/superpowers/specs/2026-08-15-owner-oversight-loop-design.md`
 * §6 ("MARATHI — THE HARD RULE") is the binding authority for every string
 * in this file. Task: `.superpowers/sdd/2026-08-15-owner-oversight-loop-plan/task-3-brief.md`.
 *
 * THE HARD RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------------
 * No agent may invent farmer-facing Marathi. Invented Marathi shipped once
 * in this project with the word order inverted — a farmer who dropped 2 of
 * 3 records was told he dropped "3 of 2". It compiled and passed every
 * test. This file keeps THREE provenances strictly apart:
 *
 *   (a) REUSED — copied character-for-character from a file where the
 *       string already exists and is already load-bearing elsewhere in the
 *       app. Every `(a)` value below is hand-transcribed from its cited
 *       source, and `__tests__/oversightTranslations.test.ts` pins the
 *       dfesTranslations-sourced ones against `dfesTranslations.ts` itself
 *       so a future edit here cannot silently drift from the source of
 *       truth (the same failure mode `translationsSplit.test.ts` guards
 *       against for the DFES split).
 *
 *   (b) PLACEHOLDER — the Devanagari spec §6.2 supplies for a concept that
 *       has NO founder-approved Marathi yet. Every `(b)` key is listed in
 *       `PENDING_FOUNDER_STRINGS` below, and its `en` value is always
 *       reachable at the same key path (`oversightTranslations.en.<key>`)
 *       regardless of the farmer's language setting, so a consuming
 *       component can render the English fallback beside the placeholder
 *       exactly as spec §6.2 requires: "The UI will render the English
 *       beside the placeholder so the founder can see exactly what is not
 *       yet his."
 *
 *   (c) KEYLESS-BUT-DECLARED (Controller Ruling 7) — a concept spec §6
 *       supplies NO Devanagari for at all, not even a placeholder. Rather
 *       than block Tasks 4/5 on a founder ruling, or invent the missing
 *       words (the one thing the Hard Rule forbids), the key is declared
 *       with `mr: ''` — the literal, honest encoding of "not written yet" —
 *       and `en` populated. `resolveOversightString()` below is the single
 *       mechanical place that reads through to `en` whenever `mr` is empty,
 *       so no consuming component has to remember which keys are hollow.
 *       Also listed in `PENDING_FOUNDER_STRINGS`.
 *
 * (a) SOURCES — cite the exact file + line copied from
 * -----------------------------------------------------
 * `src/i18n/dfesTranslations.ts` (imported into the test file only, to
 * avoid a runtime dependency between two leaf translation modules; the
 * literal values are hand-transcribed here so a broken transcription is a
 * `tsc`-invisible, test-visible failure — see file header above):
 *   welcomeBack        — dfesTranslations.ts:213 (mr) / :153 (en)
 *   weeklyReviewPrompt — dfesTranslations.ts:229 (mr) / :169 (en)
 *   farmBookOpen       — dfesTranslations.ts:231 (mr) / :171 (en)
 *   todayClosed        — dfesTranslations.ts:193 (mr) / :133 (en)
 *   needsReview        — dfesTranslations.ts:240 (mr) / :180 (en)
 *   unknown            — dfesTranslations.ts:243 (mr) / :183 (en)
 *   activitiesLogged   — dfesTranslations.ts:239 (mr) / :179 (en)
 *   entries            — dfesTranslations.ts:242 (mr) / :182 (en) — this is
 *     the tallies' AND the briefing's "records/tasks" unit word (`कामे`).
 *     Ruling 7 asked for it explicitly: reuse `entries` for that role
 *     rather than adding a duplicate key that could drift from it.
 *
 * `src/features/context/components/FarmContextSwitcher.tsx` (read-only —
 * this task may not modify it; the sheet itself stays wired to its own
 * copy per spec §2.1, "Only the trigger's shell changes." These keys exist
 * here so the new farm-chip trigger can name what it opens):
 *   yourFarms  — FarmContextSwitcher.tsx:190 (mr) / :193 (en, "Your farms")
 *   createFarm — FarmContextSwitcher.tsx:242 (mr) / :254 (en, "Create farm")
 *   joinByQr   — FarmContextSwitcher.tsx:250 (mr) / :255 (en, "Join via QR")
 *
 * `src/features/attention/pages/AttentionPage.tsx` (read-only):
 *   attention       — AttentionPage.tsx:98 (mr) / :83 (en, "Attention")
 *   allFarmsOnTrack — AttentionPage.tsx:58 (mr) / :64 (en, "All your farms
 *                     are on track today")
 *
 * (b) PLACEHOLDERS — spec §6.2, table row cited per key
 * -------------------------------------------------------
 * `waitingLabel`, `restState`, `seenControl`, `decisionLine`,
 * `delegatedLine`, `failedSends`, `recordBarIdle` and `recordBarActive`
 * carry the exact Devanagari from spec §6.2's table (design doc lines
 * 294–300). Three are templates (`decisionLine`, `delegatedLine`,
 * `failedSends`) — the spec's worked examples use a literal Devanagari
 * numeral (e.g. `६ कामे तपासायचे आहे`) to illustrate the shape; this file
 * replaces the count/name with `{count}`/`{name}` placeholders and keeps
 * every surrounding word and its position exactly as given. `recordBarIdle`
 * / `recordBarActive` split the table's single `आधी प्लॉट निवडा / बोला` row
 * on its own ` / ` — the two states shown on one row in the doc.
 *
 * `seenControl` ('मी हे पाहिलं') deliberately contains neither `मंजूर`
 * (approve) nor `खात्री` (confirm) — both already mean a decision
 * elsewhere in this app (spec §P-G, §6.2) — and
 * `__tests__/oversightTranslations.test.ts` asserts that in code so the
 * constraint cannot regress silently.
 *
 * (c) KEYLESS-BUT-DECLARED — Controller Ruling 7, `mr: ''` by design
 * ---------------------------------------------------------------------
 *   talliesPeopleUnit  — the tallies' "N लोक"-equivalent unit word; no
 *                         Marathi for "people" exists in any source this
 *                         task is authorised to reuse from.
 *   plotsUnit          — the tallies' AND the per-person row's plot-count
 *                         unit word (spec §3's "N प्लॉट" appears in both
 *                         places) — ONE key so the two can never drift.
 *                         "प्लॉट" exists elsewhere in the repo
 *                         (`translations.ts:560`) but not in a source this
 *                         task may cite from, so it stays keyless-but-
 *                         declared rather than borrowed on my own judgment.
 *   seenControlHint    — the Seen control's clarifying line (spec §P-G:
 *                         "colour + word must not imply approval"). English
 *                         text is Ruling 7's own wording verbatim.
 *   retryAffordance    — the failed-sends row's retry label.
 *   bandDecisionsHeader / bandSinceLastLookedHeader — the drawer's two
 *                         section headers, spec §3's own English titles
 *                         ("Needs your decision" / "Since you last
 *                         looked"), carried as `en` per Ruling 7.
 *
 * TASK 5 ADDITIONS (Ruling 8) — two more keyless-but-declared keys
 * ------------------------------------------------------------------
 * Ruling 8 (SDD ledger, `.superpowers/sdd/2026-08-15-owner-oversight-loop-
 * plan/progress.md`) authorised "whoever needs it" to extend this file's
 * SAME empty-`mr` + `PENDING_FOUNDER_STRINGS` pattern (category (c) above)
 * rather than block on a founder ruling or invent the missing words. Task 5
 * (`WaitingDrawer`) needs two such pieces:
 *
 *   sinceLastLookedTail — the briefing sub-line's "since you last looked —
 *     N days" tail (spec §3, the very sub-piece the file header above
 *     previously logged as absent). Template — `{days}`.
 *
 *   dayNotClosedLine — Band 1's second row source (spec §3's own table:
 *     "yesterdayDayState not closed"). The design doc's Band-1 table (§3)
 *     prints a Devanagari string for this row inline in its own prose
 *     ("कालचा दिवस बंद झाला नाही"), but — unlike §6.1's reuse table — that
 *     string is not cited as copied from an already-shipped, load-bearing
 *     source, and it is absent from §6.2's own placeholder table, which is
 *     that section's complete enumeration of what ships as a placeholder.
 *     Treating spec prose as an approved source on my own judgment is
 *     exactly the shortcut the Hard Rule forbids, so this key follows
 *     category (c), not (b): `mr: ''`, English only, pending the founder.
 *
 * `retryAffordance` (already declared above) is reused as-is for a SECOND
 * role in Task 5: the Seen control's own retry affordance when
 * `useOversightAcknowledgement`'s `status` is `'failed'` (spec §P-D). Its
 * header comment above named only "the failed-sends row's retry label",
 * but the word "Retry" is equally generic for both a failed sync-send and a
 * failed acknowledgement write, and Ruling 7's own precedent (`entries`
 * serving two roles rather than gaining a duplicate key) is the reason to
 * reuse it here too instead of adding a near-identical third key.
 *
 * (d) FOUNDER-APPROVED — Task 13, verbatim from his own reference-image table
 * -----------------------------------------------------------------------------
 * The founder supplied a screen reference (`log screen re design reference.png`)
 * with every Marathi string on it typed by his own hand, and a table pairing
 * each UI location to exact copy. Every key below is transcribed
 * character-for-character from that table — `navToday`, `navMyFarm`,
 * `navCompare`, `waitingSubtitle`, `guideGreeting`, `guideHeadline`,
 * `guideLine1`, `guideLine2`, `plotSectionHeader`, `plotSectionHint`,
 * `entireFarmLabel`, `entireFarmHint`, `helpTitle`, `helpSubtitle`,
 * `helpButtonLabel`. None are placeholders; none are in
 * `PENDING_FOUNDER_STRINGS`. `en` values are ordinary English translations of
 * the approved Marathi (translating INTO English is not the Hard Rule's
 * concern — the rule guards against inventing farmer-facing MARATHI).
 *
 * `waitingLabel` ALSO graduates out of (b)/PENDING here: the founder's table
 * gives "तुमच्यासाठी बाकी" for the same waiting-bar title `waitingLabel`
 * already names, correcting the agent placeholder "तुम्हांसाठी बाकी" (wrong
 * spelling) that shipped in Task 4. Only the `mr` value and its PENDING
 * listing change; the key, its `en` value and every consumer are untouched.
 */
import type { Language } from './language';

export interface OversightTranslations {
    // ── Reused verbatim (spec §6.1) ─────────────────────────────────────
    /** Briefing headline. dfesTranslations.welcomeBack. */
    welcomeBack: string;
    /** Briefing sub-line. dfesTranslations.weeklyReviewPrompt. */
    weeklyReviewPrompt: string;
    farmBookOpen: string;
    todayClosed: string;
    /** Decision-row suffix vocabulary. dfesTranslations.needsReview. */
    needsReview: string;
    /** The unattributed person row (spec §3, §P-F). dfesTranslations.unknown. */
    unknown: string;
    activitiesLogged: string;
    /** Also the tallies'/briefing's "records" unit word (Ruling 7). dfesTranslations.entries. */
    entries: string;

    /** Farm-chip trigger — names the sheet it opens (spec §2.1). */
    yourFarms: string;
    createFarm: string;
    joinByQr: string;
    attention: string;
    allFarmsOnTrack: string;

    // ── NOT approved — placeholders (spec §6.2). Listed in
    // PENDING_FOUNDER_STRINGS below; founder must supply real copy. ──────

    /** Canonical-strip waiting button label (spec §2.2, §6.2). */
    waitingLabel: string;
    /** Canonical-strip rest state, once nothing is waiting (spec §2.2, §6.2). */
    restState: string;
    /**
     * Drawer Band 2's acknowledgement control (spec §3, §6.2). Must never
     * read as a decision — see the file-header note on `मंजूर`/`खात्री`.
     */
    seenControl: string;
    /**
     * Drawer Band 1 row: outstanding `verification.required` count (spec
     * §3, §6.2). Template — `{count}`.
     */
    decisionLine: string;
    /**
     * Drawer Band 1 row, delegated case: same row/position, no action
     * affordance, names who holds the authority instead (spec §3, §6.2).
     * Template — `{count}`, `{name}`.
     */
    delegatedLine: string;
    /**
     * Drawer Band 1 row: the sync `NEEDS_FIX` set, phrased as work, not
     * plumbing (spec §4.1, §6.2). Template — `{count}`.
     */
    failedSends: string;
    /** Record bar before a plot is chosen (spec §5.2, §6.2). */
    recordBarIdle: string;
    /** Record bar once a plot is chosen (spec §5.2, §6.2). */
    recordBarActive: string;

    // ── Keyless-but-declared (Controller Ruling 7). `mr` is '' by design
    // — read through `resolveOversightString()`, never this field, direct.
    // Listed in PENDING_FOUNDER_STRINGS below. ───────────────────────────

    /** Tallies' people-count unit word (spec §3). No Marathi source exists. */
    talliesPeopleUnit: string;
    /**
     * Tallies' AND the per-person row's plot-count unit word (spec §3 —
     * "N प्लॉट" appears in both places; one key, so they cannot drift).
     */
    plotsUnit: string;
    /** Seen control's clarifying line — must never read as approval (spec §P-G). */
    seenControlHint: string;
    /** Failed-sends row's retry affordance label (spec §3, §4.1). */
    retryAffordance: string;
    /** Drawer Band 1's section header (spec §3). */
    bandDecisionsHeader: string;
    /** Drawer Band 2's section header (spec §3). */
    bandSinceLastLookedHeader: string;
    /**
     * Task 5 / Ruling 8. Briefing sub-line tail (spec §3): "since you last
     * looked — N days". Template — `{days}`. `null` `sinceDays` (no
     * checkpoint yet) means a consumer never renders this key at all.
     */
    sinceLastLookedTail: string;
    /**
     * Task 5 / Ruling 8. Band 1's `dayNotClosed` decision row (spec §3's
     * table: "yesterdayDayState not closed"). No template — the row carries
     * no count in the spec's own wording.
     */
    dayNotClosedLine: string;

    // ── Founder-approved (Task 13, category (d)) — verbatim from his own
    // reference-image table. Real `mr` in both languages; none pending. ────

    /** Nav card 1 — the log screen (spec: owner-oversight-loop, Task 13). */
    navToday: string;
    /** Nav card 2 — the reflect/analysis screen. */
    navMyFarm: string;
    /** Nav card 3 — the compare screen. Same word as `header.compare`
     * (`translations.ts`), independently declared here per this file's own
     * no-cross-import convention for founder copy. */
    navCompare: string;
    /** Waiting-bar subtitle, new under the (now approved) `waitingLabel`
     * title. Only rendered in the waiting state, never rest. */
    waitingSubtitle: string;
    /** Sathi guide card — greeting line, beside the leaf mark. */
    guideGreeting: string;
    /**
     * Sathi guide card — the headline, the largest text on the redesigned
     * screen. Contains the word the founder marked for emerald emphasis
     * ("प्लॉटवर" / "plot") — the consuming component splits on it at
     * render time rather than this file carrying three separate keys, so
     * the full sentence stays the single source of truth.
     */
    guideHeadline: string;
    /** Sathi guide card — first instruction line, below the divider. */
    guideLine1: string;
    /** Sathi guide card — second instruction line. */
    guideLine2: string;
    /** Plot-selector section header (replaces the old English dev copy,
     * gated behind `CropSelector`'s `hideGlobalCard` opt-in). */
    plotSectionHeader: string;
    /** Plot-selector section hint, below the header. */
    plotSectionHint: string;
    /** The demoted "Entire Farm" list row's label (spec Task 13 change 4). */
    entireFarmLabel: string;
    /** The demoted "Entire Farm" row's hint line. */
    entireFarmHint: string;
    /** Help bar — title line. */
    helpTitle: string;
    /** Help bar — sub line, under the title. */
    helpSubtitle: string;
    /** Help bar — the emerald pill button's label. */
    helpButtonLabel: string;
}

export const oversightTranslations: Record<Language, OversightTranslations> = {
    en: {
        welcomeBack: 'Welcome back! What\'s been happening?',
        weeklyReviewPrompt: 'Your farm book has new entries to review.',
        farmBookOpen: 'This week\'s farm book is open.',
        todayClosed: 'Today closed. Everything recorded.',
        needsReview: 'needs review',
        unknown: 'Unknown',
        activitiesLogged: 'activities logged',
        entries: 'entries',

        yourFarms: 'Your farms',
        createFarm: 'Create farm',
        joinByQr: 'Join via QR',
        attention: 'Attention',
        allFarmsOnTrack: 'All your farms are on track today',

        waitingLabel: 'Waiting for you',
        restState: 'Nothing waiting',
        seenControl: 'I have seen this',
        decisionLine: '{count} tasks need review',
        delegatedLine: '{count} tasks — {name} will decide',
        failedSends: '{count} records could not be sent',
        recordBarIdle: 'Choose a plot first',
        recordBarActive: 'Speak',

        talliesPeopleUnit: 'people',
        plotsUnit: 'plots',
        seenControlHint: 'Records only that you looked. It approves nothing.',
        retryAffordance: 'Retry',
        bandDecisionsHeader: 'Needs your decision',
        bandSinceLastLookedHeader: 'Since you last looked',
        sinceLastLookedTail: 'since you last looked — {days} days',
        dayNotClosedLine: "Yesterday's day was not closed",

        navToday: "Today's Tasks",
        navMyFarm: 'My Farm',
        navCompare: 'Compare',
        waitingSubtitle: 'You still have some tasks to finish.',
        guideGreeting: 'Hello!',
        guideHeadline: 'Which plot did you work on today?',
        guideLine1: 'Select one or more plots.',
        guideLine2: 'If the work isn\'t tied to a plot, choose "Entire Farm" below.',
        plotSectionHeader: 'Select plot',
        plotSectionHint: 'You can select more than one plot',
        entireFarmLabel: 'Entire Farm',
        entireFarmHint: 'Choose this when it can\'t be attributed to a plot',
        helpTitle: 'Having trouble?',
        helpSubtitle: 'I can help.',
        helpButtonLabel: 'Talk to Shram Sathi',
    },
    mr: {
        welcomeBack: 'पुन्हा स्वागत! शेतात काय चाललं?',
        weeklyReviewPrompt: 'तुमच्या शेतनोंदीत नवीन नोंदी आहेत. तपासा.',
        farmBookOpen: 'या आठवड्याची शेतनोंद उघडी आहे.',
        todayClosed: 'आजचं आटपलं. सगळी कामे आणि गोष्टी समजल्या',
        needsReview: 'तपासायचे आहे',
        unknown: 'अज्ञात',
        activitiesLogged: 'कामे नोंदवली',
        entries: 'कामे',

        yourFarms: 'तुमच्या शेती',
        createFarm: 'शेती तयार करा',
        joinByQr: 'QR ने जोडा',
        attention: 'लक्ष द्या',
        allFarmsOnTrack: 'सगळ्या शेती आज व्यवस्थित आहेत',

        waitingLabel: 'तुमच्यासाठी बाकी',
        restState: 'काही बाकी नाही',
        seenControl: 'मी हे पाहिलं',
        decisionLine: '{count} कामे तपासायचे आहे',
        delegatedLine: '{count} कामे — {name} ठरवतील',
        failedSends: '{count} नोंदी पाठवता आल्या नाहीत',
        recordBarIdle: 'आधी प्लॉट निवडा',
        recordBarActive: 'बोला',

        // Ruling 7 — keyless-but-declared. Empty on purpose: no Marathi
        // exists anywhere for these six concepts, and inventing it is the
        // one thing the Hard Rule forbids. Read through
        // `resolveOversightString()`, never this field, direct.
        talliesPeopleUnit: '',
        plotsUnit: '',
        seenControlHint: '',
        retryAffordance: '',
        bandDecisionsHeader: '',
        bandSinceLastLookedHeader: '',
        // Task 5 / Ruling 8 — same reasoning as the six above: no Marathi
        // exists anywhere this task may cite for either concept.
        sinceLastLookedTail: '',
        dayNotClosedLine: '',

        // Task 13, category (d) — verbatim from the founder's own reference
        // table. See this file's header for provenance.
        navToday: 'आजची कामे',
        navMyFarm: 'माझं शेत',
        navCompare: 'तुलना',
        waitingSubtitle: 'तुमची काही पूर्ण होण्याची कामे बाकी आहेत.',
        guideGreeting: 'नमस्कार!',
        guideHeadline: 'आज कोणत्या प्लॉटवर काम केलं?',
        guideLine1: 'एक किंवा अनेक प्लॉट निवडा.',
        guideLine2: 'प्लॉटशी संबंध नसलेलं काम असेल तर खाली "संपूर्ण शेत" निवडा.',
        plotSectionHeader: 'प्लॉट निवडा',
        plotSectionHint: 'एकापेक्षा जास्त प्लॉट निवडू शकता',
        entireFarmLabel: 'संपूर्ण शेत',
        entireFarmHint: 'प्लॉटनुसार सांगता येत नसेल तेव्हा निवडा',
        helpTitle: 'काही अडचण आहे का?',
        helpSubtitle: 'मी मदत करतो.',
        helpButtonLabel: 'श्रम साथीशी बोला',
    },
};

/**
 * Every key in this module that is NOT yet a founder-approved string —
 * category (b) placeholders (spec §6.2) and category (c) keyless-but-
 * declared keys (Ruling 7) alike. A consuming component uses this to
 * decide whether to render the `en` value beside the `mr` one;
 * `__tests__/oversightTranslations.test.ts` asserts every entry here
 * names a real key so the list can never point at a typo.
 *
 * `waitingLabel` is NOT here (Task 13 graduated it to founder-approved —
 * see this file's header, category (d)). `restState` remains pending: the
 * founder's reference table covers the waiting state only, not the rest
 * state's copy.
 */
export const PENDING_FOUNDER_STRINGS: readonly string[] = [
    'restState',
    'seenControl',
    'decisionLine',
    'delegatedLine',
    'failedSends',
    'recordBarIdle',
    'recordBarActive',
    'talliesPeopleUnit',
    'plotsUnit',
    'seenControlHint',
    'retryAffordance',
    'bandDecisionsHeader',
    'bandSinceLastLookedHeader',
    'sinceLastLookedTail',
    'dayNotClosedLine',
];

/**
 * The one mechanical place `mr: ''` (Ruling 7, category (c)) turns into
 * real text on screen. Reading `oversightTranslations.mr[key]` directly for
 * one of the six keyless-but-declared keys renders an empty string — a
 * blank label, which spec §P-H/§6.2's whole point (a visible English
 * fallback) exists to prevent. This returns `en` whenever the requested
 * language's value is empty, in either language, so a consuming component
 * never has to know — or remember — which keys are hollow.
 */
export function resolveOversightString(
    language: Language,
    key: keyof OversightTranslations,
): string {
    const value = oversightTranslations[language][key];
    if (value !== '') {
        return value;
    }
    return oversightTranslations.en[key];
}
