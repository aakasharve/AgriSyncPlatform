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
 * test. This file keeps the two provenances that make a string safe to
 * ship strictly apart:
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
 *   entries            — dfesTranslations.ts:242 (mr) / :182 (en)
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
 * NOT IN THIS FILE, AND WHY
 * --------------------------
 * Controller Ruling 2 asks this module to cover "the briefing
 * headline/sub/tallies, person row units, ... the Seen control and its
 * hint, the retry affordance." Five sub-pieces have NO Devanagari anywhere
 * in the spec (neither §6.1's reuse list nor §6.2's placeholder table) and
 * are deliberately left undefined rather than invented:
 *   - The tallies format ("N लोक · N कामे · N प्लॉट", spec §3) needs "लोक"
 *     and "प्लॉट" — neither is in an approved source for this task.
 *   - The per-person row unit ("N · N प्लॉट", spec §3) — same gap.
 *   - The "since you last looked — N days" sub-line tail (spec §3) has an
 *     English form in the spec and no Marathi form anywhere.
 *   - The Seen control's hint text — no source at all.
 *   - A distinct "retry" word for the failed-sends row — no source; per
 *     spec §3 the row itself is tappable ("tapping any row opens the
 *     existing filtered detail view"), so `failedSends` may be the only
 *     copy that row ever needs.
 *   - Band section headers ("Needs your decision" / "Since you last
 *     looked", spec §3) are used here only as ORGANISING COMMENTS on the
 *     interface below, exactly as `dfesTranslations.ts` groups its own
 *     keys with `// Closure ritual` etc. — never as a rendered string,
 *     because no Marathi was ever supplied for them.
 * A founder ruling that supplies Marathi for any of these is a follow-up
 * addition to this file, not a blocker on Tasks 4/5, which can build the
 * canonical strip and Band 1 (decision rows) entirely from the keys below.
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

        waitingLabel: 'तुम्हांसाठी बाकी',
        restState: 'काही बाकी नाही',
        seenControl: 'मी हे पाहिलं',
        decisionLine: '{count} कामे तपासायचे आहे',
        delegatedLine: '{count} कामे — {name} ठरवतील',
        failedSends: '{count} नोंदी पाठवता आल्या नाहीत',
        recordBarIdle: 'आधी प्लॉट निवडा',
        recordBarActive: 'बोला',
    },
};

/**
 * Every key in this module that is category (b) — an agent construction
 * per spec §6.2, not yet a founder-approved string. A consuming component
 * uses this to decide whether to render the `en` value beside the `mr`
 * one; `__tests__/oversightTranslations.test.ts` asserts every entry here
 * names a real key so the list can never point at a typo.
 */
export const PENDING_FOUNDER_STRINGS: readonly string[] = [
    'waitingLabel',
    'restState',
    'seenControl',
    'decisionLine',
    'delegatedLine',
    'failedSends',
    'recordBarIdle',
    'recordBarActive',
];
