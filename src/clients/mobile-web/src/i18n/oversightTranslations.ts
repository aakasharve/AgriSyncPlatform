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
 * `guideLine1`, `guideLine2`, `guideLine3`, `plotSectionHeader`,
 * `plotSectionHint`, `entireFarmLabel`, `entireFarmHint`, `helpTitle`,
 * `helpSubtitle`, `helpButtonLabel`. None are placeholders; none are in
 * `PENDING_FOUNDER_STRINGS`. `en` values are ordinary English translations of
 * the approved Marathi (translating INTO English is not the Hard Rule's
 * concern — the rule guards against inventing farmer-facing MARATHI).
 *
 * `waitingLabel` ALSO graduates out of (b)/PENDING here: the founder's table
 * gives "तुमच्यासाठी बाकी" for the same waiting-bar title `waitingLabel`
 * already names, correcting the agent placeholder "तुम्हांसाठी बाकी" (wrong
 * spelling) that shipped in Task 4. Only the `mr` value and its PENDING
 * listing change; the key, its `en` value and every consumer are untouched.
 *
 * TASK 17 — a finished visual, three instruction lines, one reworded
 * ---------------------------------------------------------------------
 * The founder supplied a second, finished reference image for this same
 * card and asked to match it exactly. It carries THREE instruction lines,
 * not two, and its third line is a reworded version of Task 13's original
 * `guideLine2` — so this task renumbers, it does not just append:
 *   - `guideLine1` — UNCHANGED verbatim ("एक किंवा अनेक प्लॉट निवडा.").
 *   - `guideLine2` — NEW slot, new sentence ("एकाच कामासाठी एकापेक्षा जास्त
 *     प्लॉट निवडू शकता."); Task 13-16 never had a second-slot sentence with
 *     this wording — there is no prior value this replaces.
 *   - `guideLine3` — Task 13's ORIGINAL `guideLine2` text, reworded by the
 *     founder ("प्लॉटशी संबंध नसलेलं काम असेल तर..." -> "काम प्लॉटशी संबंधित
 *     नसेल, तरच खाली 'संपूर्ण शेत' निवडा.") and moved to the third slot. Note
 *     the reference's own single curly quotes around संपूर्ण शेत (U+2018/
 *     U+2019), not straight or double — transcribed exactly.
 * All three are transcribed character-for-character from the founder's new
 * reference table, same (d) provenance rule as every other key in this
 * section.
 *
 * RESTSTATE GRADUATION + WAITINGSUBTITLE UPDATE — founder message, 2026-08-23
 * -----------------------------------------------------------------------------
 * The founder supplied two farmer-facing Marathi strings directly, in his own
 * words, in a coordinator message (not a reference image this time — same
 * (d) provenance rule, different medium):
 *
 *   `restState` GRADUATES out of (b)/PENDING here — his table (Task 13)
 *   covered only the waiting state, never the rest state, so `restState` had
 *   remained a spec §6.2 placeholder until now. His new copy: "आज पर्यन्त सर्व
 *   कामे पूर्ण आहेत" — transcribed exactly, including "पर्यन्त" spelled that
 *   way (not normalised to the more common "पर्यंत"). Only the `mr` value and
 *   its `PENDING_FOUNDER_STRINGS` listing change; the key, its `en` value and
 *   every consumer are untouched.
 *
 *   `waitingSubtitle` (already founder-approved, Task 13) is REWORDED, not
 *   graduated — it carries new founder copy in the same slot: "काही
 *   राहिलेल्या कामांकडे तुमचे लक्ष देणे गरजेचे आहे", transcribed exactly,
 *   including the deliberate absence of a trailing danda/full stop.
 *
 * OVERSIGHT-LOOP STRING GRADUATION (GROUPS A & B) — founder message, 2026-08-23
 * -----------------------------------------------------------------------------
 * The founder ruled on ten more farmer-facing Marathi strings directly, in
 * his own words, in a coordinator message — same (d) provenance rule as the
 * RESTSTATE graduation immediately above, same date:
 *
 *   GROUP A — the eight Ruling-7/8 keyless-but-declared keys
 *   (`talliesPeopleUnit`, `plotsUnit`, `bandDecisionsHeader`,
 *   `bandSinceLastLookedHeader`, `sinceLastLookedTail`, `dayNotClosedLine`,
 *   `seenControlHint`, `retryAffordance`) GRADUATE out of (c)/PENDING here —
 *   every `mr: ''` becomes real Marathi, transcribed character-for-character
 *   from his table, including `seenControlHint`'s single curly quotes
 *   (U+2018/U+2019) around पाहिलं — same convention `guideLine3` already
 *   uses for ‘संपूर्ण शेत’, not straight ASCII apostrophes. `dayNotClosedLine`
 *   uses "पूर्ण" ("day not COMPLETED"), never "बंद" ("closed") — the बंद
 *   metaphor is banned everywhere per commit `c66d1817` ("a day is completed
 *   by telling Sathi everything, not by closing a book").
 *
 *   GROUP B — two already-approved (b) templates are REWORDED (their
 *   `PENDING_FOUNDER_STRINGS` entries are removed too — the founder ruled on
 *   the exact final copy for both, so nothing about either is left pending):
 *     `decisionLine` — grammar-only fix, subject-verb agreement for a
 *     plural count: "{count} कामे तपासायचे आहे" -> "{count} कामे तपासायची
 *     आहेत".
 *     `failedSends` — substantive reword. The old copy named a passive
 *     state ("records could not be sent"); the founder's replacement names
 *     the problem and offers help: "{count} नोंदी पाठवता आल्या नाहीत" ->
 *     "{count} कामे अडकली आहेत — मी मदत करतो". This uses "कामे", not "नोंदी"
 *     — BECAUSE THE FOUNDER RULED ON THIS SPECIFIC STRING, not because open
 *     founder question #1 (`shram-sathi-FINAL-strings.md`, whether "नोंदी"
 *     is banned in Sathi's own first-person lines vs "कामे") is settled. A
 *     previous agent resolved that general question by inference and was
 *     reverted (commit `06797135`); this key's wording is direct founder
 *     transcription, not inference, and does NOT extend to `closeToday` or
 *     any other `dfesTranslations.ts` string.
 *
 * Only the ten `mr` values above and their `PENDING_FOUNDER_STRINGS` listing
 * change; every key, its `en` value and every consumer are untouched.
 *
 * FINDING F7 — ONE NEW (c) KEY, AND ONE ENGLISH RECONCILIATION
 * --------------------------------------------------------------
 * `checkingState` is a category (c) key: `mr: ''`, English populated,
 * listed in `PENDING_FOUNDER_STRINGS`. It is the canonical strip's label
 * while the data behind it is still being read — the state that must exist
 * so `restState` ("all work is complete as of today") is never rendered
 * from data nobody has loaded yet. No Marathi is invented for it. Category
 * (c) is exactly the mechanism the Hard Rule leaves open for this: an
 * honest empty, an English fallback the farmer can still read, and a
 * founder-facing flag. It is the FIFTH entry in `PENDING_FOUNDER_STRINGS`,
 * which held exactly four before this change.
 *
 * `en.restState` is RECONCILED, not reworded-by-invention: it read
 * "Nothing waiting" while the founder's Marathi in the same slot asserts
 * that work is complete ("आज पर्यन्त सर्व कामे पूर्ण आहेत"). Two languages,
 * one key, two different claims — an English-speaking user and a Marathi-
 * speaking user were being told different things by the same line. The
 * Marathi is founder-authored and is NOT touched; the English is an
 * ordinary translation of it (translating INTO English is not the Hard
 * Rule's concern, same note as category (d) above), so the English moved.
 *
 * CHANGE 2 — ONE MORE (c) KEY: `unknownState`, THE END OF THE ENDLESS SPINNER
 * -----------------------------------------------------------------------------
 * `checkingState` had no bound. `useSyncQueueStatus` sets `hasLoaded` only
 * after a fully successful Dexie read and re-reads every 3s forever, and
 * `useAppData` runs its load pass ONCE with no retry at all — so a device
 * whose first read throws stays "Checking…" for as long as the app is open.
 * A spinner that never stops reads as "broken" to a farmer, and it tells him
 * nothing about his own work.
 *
 * `unknownState` is what the strip says once it has stopped trying: an
 * honest "we could not establish this", never a spinner, never the green
 * tick, never a count nobody measured. Category (c), same terms as
 * `checkingState`: `mr: ''` (no agent Marathi), a real English value read
 * through by `resolveOversightString()`, and a `PENDING_FOUNDER_STRINGS`
 * entry so the founder sees it is not yet his. Seventh entry; the list held
 * exactly six before this change.
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
    /**
     * Canonical-strip rest state, once nothing is waiting (spec §2.2, §6.2).
     *
     * The `mr` value is founder-authored and asserts that work is COMPLETE,
     * not merely that a queue is empty — so it may only render when that is
     * actually known to be true. See `checkingState` for the state that
     * covers "not known yet" (finding F7(a)).
     */
    restState: string;
    /**
     * Canonical-strip state while the data behind the rest state is still
     * being read — Dexie's sync queue (`useSyncQueueStatus.hasLoaded`) and
     * the app's own hydration (`useAppData.dataLoaded`). Keyless-but-
     * declared (category (c)): `mr: ''` until the founder supplies real
     * Marathi, English fallback in the meantime via
     * `resolveOversightString()`. Listed in `PENDING_FOUNDER_STRINGS`.
     */
    checkingState: string;
    /**
     * Canonical-strip state once the app has STOPPED trying to read the data
     * behind the rest state (change 2). `checkingState` says "reading";
     * this says "we could not establish it, and we will not pretend
     * otherwise" — the honest terminus a spinner has to have, because the
     * two sources behind `waitingCount` can both fail permanently
     * (`useAppData`'s load pass never retries; `useSyncQueueStatus.hasLoaded`
     * only ever flips on a fully successful Dexie read).
     *
     * Deliberately NOT worded as a transient ("…right now") and NOT worded
     * as a fault ("something went wrong"): it is the exact negation of
     * `restState`'s claim and nothing more, so it stays true whatever caused
     * it. That wording is load-bearing — change 3 gives the same key a
     * SECOND cause, an account holding more than one farm, where the app's
     * data is not farm-scoped and so the completion claim has no statable
     * subject (`app/helpers/appContentOversightInputs.ts`). One is a failed
     * read, the other is a structural limit; naming either cause in the
     * string would make it false for the other.
     *
     * Keyless-but-declared (category (c)): `mr: ''` until the founder
     * supplies real Marathi, English fallback in the meantime via
     * `resolveOversightString()`. Listed in `PENDING_FOUNDER_STRINGS`.
     */
    unknownState: string;
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
    /**
     * Drawer Band 1 row: records that reached NO sync queue at all — finding
     * F6 (spec §4.1). Template — `{count}`.
     *
     * DELIBERATELY NOT `failedSends`, and deliberately not worded like it.
     * `failedSends` says "अडकली आहेत — मी मदत करतो" ("stuck — I will help"),
     * which promises a retry. Nothing will ever send THESE records, so that
     * promise would be false (`P5`: never teach the farmer a button works
     * when it does not). The English below is the same register
     * `SyncStatusDrawer` — the surface this row opens — already uses about
     * exactly these records: "will not reach your farm records".
     *
     * Category (c): `mr: ''` until the founder supplies his own words, read
     * through `resolveOversightString()`. Listed in
     * `PENDING_FOUNDER_STRINGS`.
     */
    unsendableRecordsLine: string;
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
    /**
     * Sathi guide card — second instruction line (Task 17, NEW slot): you
     * may pick more than one plot for the SAME task.
     */
    guideLine2: string;
    /**
     * Sathi guide card — third instruction line, the "Entire Farm" caveat.
     * Task 17 reworded this from Task 13's original `guideLine2` text and
     * moved it to this slot (see file header, category (d), "TASK 17").
     */
    guideLine3: string;
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
        // Finding F7 — reconciled with the founder's Marathi in the same
        // slot ("आज पर्यन्त सर्व कामे पूर्ण आहेत"), which asserts completed
        // work, not an empty queue. Was 'Nothing waiting'.
        restState: 'All work is complete as of today',
        checkingState: 'Checking…',
        // Change 2 — the exact negation of `restState` above, and nothing
        // more. No cause named (there are two, and neither is the farmer's
        // doing), no "right now" (one of the two is not transient), no
        // apology. Short enough to render unclipped in the strip's title
        // slot at 320px — measured, see the change-2 report.
        unknownState: 'Cannot confirm all work is done',
        seenControl: 'I have seen this',
        decisionLine: '{count} tasks need review',
        delegatedLine: '{count} tasks — {name} will decide',
        failedSends: '{count} records could not be sent',
        // Finding F6 — matches `SyncStatusDrawer`'s own wording about these
        // exact records. States what they are; promises no retry.
        unsendableRecordsLine: '{count} records will not reach your farm records',
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
        guideLine2: 'You can select more than one plot for the same task.',
        guideLine3: 'Only choose "Entire Farm" below if the work isn\'t related to a plot.',
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
        restState: 'आज पर्यन्त सर्व कामे पूर्ण आहेत',
        // Finding F7 — category (c), keyless-but-declared. NO Marathi is
        // invented here; `resolveOversightString()` reads through to the
        // English until the founder supplies his own words.
        checkingState: '',
        // Change 2 — category (c), keyless-but-declared, same terms as
        // `checkingState` directly above. NO Marathi is invented here;
        // `resolveOversightString()` reads through to the English until the
        // founder supplies his own words.
        unknownState: '',
        seenControl: 'मी हे पाहिलं',
        decisionLine: '{count} कामे तपासायची आहेत',
        delegatedLine: '{count} कामे — {name} ठरवतील',
        failedSends: '{count} कामे अडकली आहेत — मी मदत करतो',
        // Finding F6 — category (c), keyless-but-declared. NO Marathi is
        // invented here. The nearest existing Marathi (`failedSends`) says
        // "मी मदत करतो", which would be a promise this class of record can
        // never keep, so it is NOT borrowed. `resolveOversightString()`
        // reads through to the English until the founder rules.
        unsendableRecordsLine: '',
        recordBarIdle: 'आधी प्लॉट निवडा',
        recordBarActive: 'बोला',

        // GRADUATED 2026-08-23 — founder-approved, transcribed verbatim from
        // his own coordinator message (see this file's header, "OVERSIGHT-
        // LOOP STRING GRADUATION" paragraph). No longer keyless-but-declared
        // — Ruling 7/8's `mr: ''` placeholders are gone.
        talliesPeopleUnit: 'माणसं',
        plotsUnit: 'प्लॉट',
        seenControlHint: 'यानं फक्त ‘पाहिलं’ एवढंच कळतं — मंजुरी मिळत नाही.',
        retryAffordance: 'पुन्हा पाठवा',
        bandDecisionsHeader: 'तुम्ही ठरवायचं आहे',
        bandSinceLastLookedHeader: 'तुम्ही शेवटचं पाहिल्यानंतर',
        sinceLastLookedTail: 'तुम्ही शेवटचं पाहिल्यानंतर — {days} दिवस',
        dayNotClosedLine: 'काल दिवस पूर्ण झाला नाही',

        // Task 13, category (d) — verbatim from the founder's own reference
        // table. See this file's header for provenance.
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
    },
};

/**
 * Every key in this module that is NOT yet a founder-approved string —
 * category (b) placeholders (spec §6.2) only, as of 2026-08-23. Category
 * (c) keyless-but-declared keys (Ruling 7/8) are ALL graduated out now (see
 * below). A consuming component uses this to decide whether to render the
 * `en` value beside the `mr` one; `__tests__/oversightTranslations.test.ts`
 * asserts every entry here names a real key so the list can never point at
 * a typo.
 *
 * `waitingLabel` is NOT here (Task 13 graduated it to founder-approved —
 * see this file's header, category (d)). `restState` is NOT here either —
 * the founder supplied it directly, in his own words, in a coordinator
 * message dated 2026-08-23 (see this file's header, category (d), the
 * "RESTSTATE GRADUATION" paragraph).
 *
 * `talliesPeopleUnit`, `plotsUnit`, `bandDecisionsHeader`,
 * `bandSinceLastLookedHeader`, `sinceLastLookedTail`, `dayNotClosedLine`,
 * `seenControlHint`, `retryAffordance`, `decisionLine` and `failedSends` are
 * NOT here either — a further founder message, same date (2026-08-23),
 * ruled on all ten (see this file's header, "OVERSIGHT-LOOP STRING
 * GRADUATION" paragraph).
 *
 * `checkingState` (finding F7) is the one category (c) key in the module
 * again — `mr: ''`, English fallback — so this list went from exactly four
 * entries to exactly five. That is a deliberate, reported addition, not
 * drift: see this file's header, "FINDING F7".
 *
 * `unsendableRecordsLine` (finding F6) is the SECOND category (c) key, so
 * the list is now exactly six. Also deliberate and also reported: the
 * waiting drawer needed a row for records that reached no sync queue at
 * all, and the only Marathi that could have been reused (`failedSends`)
 * promises a retry these records will never get. Founder must rule.
 */
export const PENDING_FOUNDER_STRINGS: readonly string[] = [
    'seenControl',
    'delegatedLine',
    'recordBarIdle',
    'recordBarActive',
    'checkingState',
    'unsendableRecordsLine',
    'unknownState',
];

/**
 * The one mechanical place `mr: ''` (Ruling 7, category (c)) turns into
 * real text on screen. Reading `oversightTranslations.mr[key]` directly for
 * a keyless-but-declared key renders an empty string — a blank label, which
 * spec §P-H/§6.2's whole point (a visible English fallback) exists to
 * prevent. This returns `en` whenever the requested language's value is
 * empty, in either language, so a consuming component never has to know —
 * or remember — which keys are hollow. As of 2026-08-23 (see this file's
 * header, "OVERSIGHT-LOOP STRING GRADUATION") no key in this module
 * currently has an empty `mr` — Ruling 7/8's eight keyless-but-declared keys
 * all graduated to real founder Marathi — but the function stays: it is
 * generic fallback infrastructure for whichever key next ships as `mr: ''`,
 * not code specific to those eight. Finding F7 made it load-bearing again:
 * `checkingState` ships `mr: ''` and reaches the farmer through this
 * function, and finding F6 added a second such key,
 * `unsendableRecordsLine`.
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
