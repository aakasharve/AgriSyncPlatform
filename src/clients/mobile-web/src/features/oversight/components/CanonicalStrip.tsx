/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * CanonicalStrip — Task 4 built this as two side-by-side buttons (design
 * doc §2). Task 11 restructured it under a founder instruction that moved
 * the farm trigger up into row 1, beside the profile avatar (see git
 * history for that shell). Task 12 is a second founder-approved restyle,
 * against `G:\VALIDATION\farm-selector-contextual.html` (the farm element)
 * and the header-card mock referenced in the same task brief (the waiting
 * tray) — both supersede Task 11's shells below, not Task 4's.
 *
 *   Row 1:    [avatar][farm]                                      [weather]
 *   Row 1.5:  [ आजची कामे ][ माझं शेत ][ तुलना ]  — OversightNavCards, Task 13
 *   Row 2:    [ waiting tray — FULL WIDTH, inset ~12px both sides   N  ⌄ ]
 *
 * Task 13 (founder-approved reference image + his own Marathi table) moved
 * the centre [Log | Reflect | Compare] toggle OUT of row 1 into its own row
 * beneath it (`AppHeader.tsx`'s `OversightNavCards`, not this file) — see
 * that component for the restyle. This file's own row 2 is unmoved; it
 * gains a subtitle line under the (now founder-approved) waiting title,
 * documented at `subtitleText` below.
 *
 * This file owns two separate pieces:
 *
 *   `FarmIdentityElement` (named export, replaces Task 11's
 *   `CompactFarmChip`) — row 1's farm-identity trigger. Task 12's rule,
 *   stated once by the approved reference doc: "farmCount === 1 -> label
 *   (no chevron, no tint, not focusable) · farmCount >= 2 -> button (tint +
 *   chevron + count, opens the sheet)." One condition, one element, two
 *   presentations — no second component, no feature flag. Unlike Task 11's
 *   shell, the farm name AND plot count are visible text again in BOTH
 *   states (Task 11 had measured them out at 390px when the row also
 *   carried a settings gear; Task 12 removes that gear from the header
 *   entirely — see `AppHeader.tsx` — which is what recovers the room this
 *   needs; re-measured live for this task, see the task-12 report).
 *
 *   `CanonicalStrip` (default export) — row 2, the waiting button ALONE,
 *   full width, now styled as an INSET TRAY rather than a full-bleed
 *   banner: `rounded-2xl`, a soft amber gradient + border + shadow when
 *   something is waiting, a drag-handle bar so it reads as openable, and a
 *   plain white/stone-200 rest state at the exact same place and height.
 *   Every Task-4 locked behaviour is unchanged underneath the restyle:
 *   rest-state keeps its exact place/height (`min-h-[52px]`),
 *   `waitingCount` is a prop read straight off `OversightModel` (never a
 *   literal), the §P-G colour rule (amber waiting / never-emerald), and
 *   every string via `resolveOversightString()`
 *   (`oversightTranslations.ts`) only.
 *
 * Both presentational only — props in, markup out. No data fetching, no
 * Dexie, no hooks that read storage.
 *
 * FINDING F7(a) — THERE ARE THREE STATES, NOT TWO
 * -------------------------------------------------
 * waiting · checking · rest. The rest state is not "the absence of
 * waiting" — it is a positive claim, in the founder's own words, that all
 * work is complete as of today. Every input behind `waitingCount` starts
 * empty and fills in asynchronously, so "not waiting" and "nothing
 * outstanding" are different facts, and this component now renders them
 * differently. `dataResolved` (required prop) is what separates them; see
 * its own doc comment. Same slot, same 52px, same layout — only the icon,
 * the tint and the label differ, so the strip stays the fixed landmark
 * spec §2.2 requires.
 *
 * CHANGE 2 — AND NOW FOUR: "CHECKING…" NEEDED A TERMINUS
 * ---------------------------------------------------------
 * waiting · checking · UNKNOWN · rest. F7(a) gave the strip an honest
 * "we have not read this yet" state but no way out of it. Neither source
 * behind `dataResolved` guarantees an answer: `useAppData` runs ONE load
 * pass with no retry, and `useSyncQueueStatus.hasLoaded` flips only on a
 * fully successful Dexie read. Either failing leaves the strip spinning for
 * the whole session — which a farmer reads as "broken", while telling him
 * nothing about his own work.
 *
 * So the checking state is now bounded by `CHECKING_TIMEOUT_MS` (see that
 * constant for how the number is derived from those two sources' real
 * behaviour, not chosen). Past it the strip renders `unknownState`: a still
 * question mark, stone not emerald and not amber, and a label that is the
 * exact negation of the rest state's claim. Not a spinner, not a green
 * tick, not a fabricated count — the three things a bounded honest state
 * exists to prevent.
 *
 * CHANGE 3 — THE SAME NON-CLAIM, FOR A SECOND REASON: MULTIPLE FARMS
 * ---------------------------------------------------------------------
 * The rest state names a subject as well as a fact, and the subject a
 * farmer reads it against is the farm named in the chip beside it. On an
 * account with more than one farm the app cannot make that scoped claim —
 * `appContentOversightInputs.ts` says so in its own words — so it makes
 * none: `farmCount >= 2` routes to the SAME `unknownState` surface, whose
 * wording names the outcome and never the cause precisely so it can carry
 * both. Full reasoning, including why filtering by farm would be worse than
 * suppressing, is on the `farmCount` prop below.
 *
 * TRUTH FIX — CHANGE 3 SUPPRESSED THE SENTENCE AND LEFT THE NUMBER
 * -------------------------------------------------------------------
 * CHANGE 3 stopped the rest state making a farm-scoped claim it could not
 * make, and its own reasoning named the reason: the chip's plot count "is the
 * sum of EVERY farm's plots, printed under ONE farm's name." That number went
 * on rendering 100px away, unsuppressed, making the same mis-scoped claim in
 * fewer words — and printing a confident "० प्लॉट" from data that had not been
 * read yet. `FarmIdentityElement` now renders the plot line only when
 * `dataResolved && farmCount === 1`. Full reasoning on its `dataResolved`
 * prop. Truth audit, question 3. Doctrine P4.
 */
import React from 'react';
import { LandPlot, ChevronDown, AlertTriangle, CheckCircle2, Loader2, HelpCircle } from 'lucide-react';
import type { Language } from '../../../i18n/language';
import { oversightTranslations, resolveOversightString, PENDING_FOUNDER_STRINGS } from '../../../i18n/oversightTranslations';

// Devanagari block. Used only to pick which of the two locked fonts a
// resolved string needs (root CLAUDE.md Font Rules) — never to decide
// *what* text renders, which is `resolveOversightString()`'s job alone.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

// Spec §2: "both 52px tall (above the 44px minimum)". Kept as the waiting
// button's own constant so its two states (waiting/rest) can never drift
// from each other.
const STRIP_MIN_HEIGHT = '52px';

/**
 * CHANGE 2 — HOW LONG THE STRIP MAY SAY "CHECKING…" BEFORE IT ADMITS IT
 * CANNOT SAY.
 *
 * DERIVED FROM THE TWO SOURCES BEHIND `dataResolved`, not chosen for the
 * round number:
 *
 *   `useSyncQueueStatus` (`features/sync/hooks/useSyncQueueStatus.ts`) reads
 *   Dexie once on mount and then every 3000ms, forever, and sets `hasLoaded`
 *   ONLY after every read in the pass resolved — its `catch` deliberately
 *   leaves the flag alone, so a throwing read never licenses a completion
 *   claim.
 *
 *   `useAppData` (`app/hooks/useAppData.ts`) sets `dataLoaded` on the last
 *   line of a single load pass. There is NO retry: if any `await` in that
 *   pass throws, the flag stays `false` for the life of the session.
 *
 * 8000ms therefore covers three whole sync-queue attempts (t=0, 3000, 6000)
 * plus ~2s of slack for the third to resolve on a slow phone, and it is well
 * past the point where `useAppData`'s one non-retrying pass would have
 * finished. A device still unresolved after that is not slow — it is stuck,
 * and the honest thing is to stop spinning and say so.
 *
 * The cost of being wrong is deliberately asymmetric and cheap: the strip
 * says "cannot confirm" for a moment and then, the instant `dataResolved`
 * flips true, renders the real state. Nothing is lost. The reverse — a
 * spinner that never stops — is what a farmer reads as "broken", with no
 * information about his own work to show for it.
 */
const CHECKING_TIMEOUT_MS = 8000;

export interface FarmIdentityElementProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /** Current farm's display name — visible text in both presentations. */
    farmName: string;
    /** Current farm's plot count — visible text in both presentations. */
    plotCount: number;
    /**
     * The account's TOTAL farm count. Decides the presentation, per the
     * approved reference's own rule, stated once: "farmCount === 1 -> label
     * · farmCount >= 2 -> button." Never a literal — always
     * `farmContext.farms.length` from the caller (`AppHeader.tsx`).
     */
    farmCount: number;
    /**
     * Whether the data behind `plotCount` has actually been READ yet —
     * `useAppData.dataLoaded && useSyncQueueStatus.hasLoaded`, the SAME flag
     * `CanonicalStrip` below already takes for its rest state, derived once in
     * `AppHeader.tsx` and never a literal.
     *
     * TRUTH FIX (truth audit, question 3) — WHY A FARM LABEL NEEDS THIS.
     *
     * WHAT THE PLOT LINE CLAIMED: "N प्लॉट", printed directly under ONE farm's
     * name, reads as that farm's plot count.
     *
     * WHY THE DATA CANNOT BACK IT — twice over:
     *
     *   1. WRONG SUBJECT. `plotCount` is `appContentOversightInputs.ts`'s
     *      `crops.reduce((sum, crop) => sum + crop.plots.length, 0)` over
     *      `dataSource.crops.getAll()` — every crop belonging to the SIGNED-IN
     *      USER, not to `currentFarmId`. That module states it in its own
     *      words: this data "is NOT scoped to `currentFarmId` for an account
     *      with more than one farm". So on a 2+ farm account the number sums
     *      every farm while the name beside it picks one.
     *
     *   2. UNREAD IS NOT ZERO. `AppHeader.tsx`'s `oversightData?.plotCount
     *      ?? 0` yields `0` before the first load completes, and "० प्लॉट" is
     *      a confident statement that the farm has no plots at all — the same
     *      "strengthen the claim by silence" `dataResolved` exists to stop on
     *      the strip below.
     *
     * NOT A FILTER, for a harder reason than CHANGE 3's: `CropProfile` carries
     * no `farmId` at all, so there is nothing to filter on. Inventing a
     * per-farm plot count is precisely what doctrine P4 forbids. Suppress the
     * claim, touch no data.
     *
     * REQUIRED, never optional, for the same reason `CanonicalStripProps`'
     * `dataResolved` is: an optional flag invites `?? true` at a call site,
     * and `true` is exactly the value that re-enables the claim.
     */
    dataResolved: boolean;
    /** Opens the existing `FarmSwitcherSheet` unchanged (spec §2.1). Only
     * called when `farmCount >= 2` — the label presentation has no handler
     * to call it with. */
    onOpenFarmSwitcher: () => void;
}

/**
 * Row 1's farm-identity element (Task 12, `G:\VALIDATION\
 * farm-selector-contextual.html`). "The control appears only if there is a
 * choice":
 *
 *   `farmCount === 1` — a LABEL. No chevron, no tint, no count badge, not a
 *   `<button>`, not focusable, no click handler — a `<span>` with no
 *   `onClick`/`tabIndex` at all, so it cannot look or behave like a
 *   control by construction, not just by CSS. Most farmers have exactly
 *   one farm and see this. Named test:
 *   `a_single_farm_account_renders_no_farm_switcher_control`.
 *
 *   `farmCount >= 2` — the SAME information becomes a `<button>`: tinted
 *   `bg-emerald-50`, `rounded-full`, a solid-emerald count badge (how many
 *   farms, without opening anything), and a chevron. Opens the existing
 *   `FarmSwitcherSheet`, unchanged — only this trigger's shell is new.
 *   Named test: `a_multi_farm_account_renders_the_switcher_with_a_count`.
 *
 * Both presentations keep the farm name AND plot count as visible text
 * (unlike Task 11's `CompactFarmChip`, which had measured them out of a
 * row that also carried a settings gear — Task 12 removes that gear from
 * the header, which is what recovers the room this needs; re-measured live
 * for this task in a real browser, see the task-12 report).
 */
export const FarmIdentityElement: React.FC<FarmIdentityElementProps> = ({
    language,
    farmName,
    plotCount,
    farmCount,
    dataResolved,
    onOpenFarmSwitcher,
}) => {
    const plotsUnitText = resolveOversightString(language, 'plotsUnit');
    const plotLine = `${plotCount} ${plotsUnitText}`;
    const isMulti = farmCount >= 2;

    // TRUTH FIX (truth audit, question 3) — the one condition under which this
    // element may state a plot count at all. Read `dataResolved`'s prop doc
    // above for what each half rules out: `farmCount === 1` the wrong subject,
    // `dataResolved` the confident zero from unread data. `farmCount === 0`
    // (an account with no farm yet) is correctly excluded by the same test —
    // there is no farm for the count to be about.
    const mayStatePlotCount = dataResolved && farmCount === 1;

    const farmMark = (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-emerald-600 text-white">
            <LandPlot size={12} strokeWidth={2.25} />
        </span>
    );

    const nameLine = (colorClass: string) => (
        <span
            className={`block truncate text-[13.5px] font-extrabold leading-[1.1] tracking-tight ${colorClass}`}
        >
            {farmName}
        </span>
    );

    const plotLineNode = (colorClass: string) => (
        <span
            className={`mt-px block truncate text-[9px] leading-tight ${colorClass}`}
            style={fontStyleFor(plotLine)}
        >
            {plotLine}
        </span>
    );

    if (!isMulti) {
        // A FACT, not a control (spec: farm-selector-contextual.html). No
        // `onClick`, no `tabIndex` — structurally inert, not merely
        // visually plain.
        return (
            <span
                data-testid="canonical-strip-farm-chip"
                title={farmName}
                className="flex max-w-[150px] shrink-0 items-center gap-1.5 py-0.5"
            >
                {farmMark}
                <span className="min-w-0">
                    {nameLine('text-stone-800')}
                    {mayStatePlotCount && plotLineNode('text-stone-400')}
                </span>
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onOpenFarmSwitcher}
            data-testid="canonical-strip-farm-chip"
            aria-label={
                mayStatePlotCount
                    ? `${resolveOversightString(language, 'yourFarms')}: ${farmName} — ${plotLine}`
                    : `${resolveOversightString(language, 'yourFarms')}: ${farmName}`
            }
            title={farmName}
            className="flex max-w-[178px] shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 py-0.5 pl-1 pr-1.5"
        >
            {farmMark}
            <span className="min-w-0">
                {nameLine('text-emerald-900')}
                {/* The SAME condition as the label branch, deliberately not a
                    second rule. It can never be true here today — this branch
                    only runs at `farmCount >= 2`, which is exactly the case
                    whose plot count sums other farms. Written as the shared
                    condition rather than deleted so that the day `plotCount`
                    becomes farm-scoped, one guard governs both presentations
                    instead of one of them silently staying dark. */}
                {mayStatePlotCount && plotLineNode('text-emerald-700/85')}
            </span>
            <span
                data-testid="canonical-strip-farm-count-badge"
                className="flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-extrabold text-white"
                style={ENGLISH_FONT}
            >
                {farmCount}
            </span>
            <ChevronDown size={12} className="shrink-0 text-emerald-600/80" />
        </button>
    );
};

export interface CanonicalStripProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /**
     * `OversightModel.waitingCount` (`oversightSelectors.ts`), derived from
     * real records. A numeric literal here anywhere is a defect.
     */
    waitingCount: number;
    /**
     * Whether the data `waitingCount` was derived from has actually been
     * READ yet — `useSyncQueueStatus.hasLoaded && useAppData.dataLoaded`,
     * both threaded through `AppHeader`.
     *
     * Finding F7(a). `waitingCount === 0` is what turns this button into the
     * rest state, and the rest state is a positive claim in the founder's
     * own words: "आज पर्यन्त सर्व कामे पूर्ण आहेत" — all work is complete as
     * of today. Every source behind that number starts empty and fills in
     * asynchronously, so without this flag the claim renders during the
     * first-load window, from the absence of rows nobody has read.
     *
     * REQUIRED, never optional: an optional flag invites `?? true` at a call
     * site, which is the same "strengthen the claim by silence" this exists
     * to stop. `false` costs nothing — a strip that says "checking" for one
     * extra frame is honest; a green tick over unread data is not.
     *
     * It gates ONLY the rest state. A non-zero `waitingCount` mid-load is a
     * real, derived count that may still GROW — reporting it early
     * understates, which is a different and much smaller sin than claiming
     * completion.
     */
    dataResolved: boolean;
    /**
     * The account's TOTAL farm count — the SAME number, from the same
     * source, that `FarmIdentityElement` above already takes
     * (`farmContext.farms.length`, derived once in `AppHeader.tsx`, never a
     * literal).
     *
     * CHANGE 3 — WHY A LAYOUT COMPONENT NEEDS THIS.
     *
     * The rest state's founder Marathi ("आज पर्यन्त सर्व कामे पूर्ण आहेत")
     * is a claim about a SUBJECT, and the subject a farmer reads it against
     * is the farm named in the chip 100px to its left. The app cannot make
     * that scoped claim. Its own reducer says so in its own words:
     * `app/helpers/appContentOversightInputs.ts` — "`history`/`crops` come
     * from `dataSource.{logs,crops}.getAll()` ... this data is NOT scoped to
     * `currentFarmId` for an account with more than one farm."
     *
     * That mis-scoping is already visible on the same strip: the chip's plot
     * count is `oversightHeaderInputs.plotCount`, the sum of EVERY farm's
     * plots, printed under ONE farm's name. Rendering a completion claim in
     * that frame attaches a sentence to a subject it was not computed for.
     *
     * Stated precisely, because the imprecise version is the tempting one:
     * the arithmetic behind `waitingCount === 0` is a SUPERSET check (all
     * farms, not this one), so it does not produce a numerically false zero.
     * The defect is the subject, not the sum — and a claim whose scope the
     * app cannot state is one it should not make (spec §P-F).
     *
     * NOT A FILTER. Filtering these logs by farm would be far worse:
     * `meta.farmId` is present on synced records (the server's own value,
     * read back in `logsReconciler.ts`) but absent on locally-created ones
     * whenever `SessionStore.getCurrentFarmId()` was null at save time
     * (`stampCreationFarmId` is a deliberate no-op then). Filtering on an
     * inconsistently-present field would silently HIDE the farmer's own
     * unsynced work. So: suppress the claim, touch no data.
     *
     * REQUIRED, never optional, for the same reason `dataResolved` is: an
     * optional count invites `?? 1` at a call site, and `1` is exactly the
     * value that re-enables the claim.
     */
    farmCount: number;
    /** Opens the waiting drawer (spec §3). */
    onToggleWaiting: () => void;
}

/**
 * Row 2 — the waiting button, alone, full width. The solid `bg-amber-600`
 * full-width banner Task 4/11 shipped read as an error state; Task 12
 * replaced it with a light amber GRADIENT card plus a custom drop shadow, a
 * drag-handle bar, and a plain white/stone-200 rest state.
 *
 * TASK 14, CHANGE 8 — STOP FEELING PASTED ON
 * -----------------------------------------------
 * Founder, on the built screen: "that section still feels like overridden
 * or not a part of the application, change the design aesthetics of it."
 * Task 12's gradient (`from-[#FFFDF7] to-amber-50`) and its bespoke amber
 * drop shadow (`shadow-[0_3px_10px_-4px_...]`) are exactly what made it
 * read as a floating tray dropped ON TOP of the page rather than a card
 * belonging to it — nothing else in this feature uses a gradient
 * background or a one-off coloured shadow. `OversightNavCards.tsx` (the
 * row directly above this one) is the reference: `rounded-2xl`, a single
 * flat `border`, a solid tint background when active
 * (`border-emerald-200 bg-emerald-50`), no shadow at all. This restyle
 * matches that exactly, swapped to amber for the waiting state
 * (`border-amber-200 bg-amber-50`) — same corner radius, same border
 * weight, same (lack of) elevation as the cards it now visually belongs
 * with. The founder's ruling was aesthetic, not structural: still
 * FULL-WIDTH, same place, same `min-h-[52px]`, same amber-vs-stone colour
 * rule (§P-G), same count badge, same quiet rest state, every Task-4
 * behaviour (§2.2) unchanged underneath.
 */
const CanonicalStrip: React.FC<CanonicalStripProps> = ({
    language,
    waitingCount,
    dataResolved,
    farmCount,
    onToggleWaiting,
}) => {
    // CHANGE 2 — THE ONE PIECE OF STATE IN THIS FILE, AND IT IS A CLOCK.
    //
    // This component's contract is "props in, markup out" (file header), and
    // that still holds: nothing below fetches, reads Dexie, or derives a
    // fact about the farm. What it measures is how long THIS component has
    // been unable to say anything — a property of the render, not of the
    // data — so it belongs here rather than as a fourth flag threaded down
    // from `AppHeader`, which would need the identical timer anyway and
    // would put a rendering concern in a data-assembling component.
    //
    // The effect is keyed on `dataResolved` alone, so:
    //   resolved      -> no timer at all, and any earlier give-up is cleared
    //                    (a later re-hydration always wins over an old one).
    //   not resolved  -> reset to "still checking", then one timer.
    const [checkingTimedOut, setCheckingTimedOut] = React.useState(false);
    React.useEffect(() => {
        setCheckingTimedOut(false);
        if (dataResolved) {
            return;
        }
        const timer = window.setTimeout(() => setCheckingTimedOut(true), CHECKING_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
    }, [dataResolved]);

    const isWaiting = waitingCount > 0;
    // FINDING F7(a) — the rest state is a CLAIM, and a claim needs evidence.
    // A zero that has not been measured yet is "we do not know", not "there
    // is nothing", so it renders as its own third state rather than
    // borrowing the completed-work one. See `dataResolved`'s prop doc.
    //
    // CHANGE 2 splits that third state in two. "We are reading" is only
    // honest while something is still expected to arrive; past
    // `CHECKING_TIMEOUT_MS` (see its own doc for how that number is derived
    // from the two sources' real retry behaviour) the spinner becomes a
    // claim of its own — "hold on, this is about to resolve" — that nothing
    // supports. So it stops, and the strip says the only true thing left:
    // it cannot confirm. Never a tick, never a fabricated count, never an
    // endless spinner.
    const isChecking = !isWaiting && !dataResolved && !checkingTimedOut;
    // CHANGE 3 — the SECOND thing that makes the completion claim
    // unavailable, and it is not a failure at all: an account holding more
    // than one farm. See `farmCount`'s prop doc for why the claim is
    // suppressed rather than filtered. Both causes land on the same
    // non-claiming surface deliberately: `unknownState` is worded as the
    // outcome ("cannot confirm"), never the cause, so it stays true for a
    // read that never finished AND for a scope the app cannot state.
    // Ordered after `isChecking` so a multi-farm account still sees the
    // spinner while its data is genuinely loading, not a verdict before the
    // read.
    const isUnknown = !isWaiting && !isChecking && (!dataResolved || farmCount >= 2);
    const primaryKey = isWaiting
        ? 'waitingLabel'
        : (isChecking ? 'checkingState' : (isUnknown ? 'unknownState' : 'restState'));
    const primaryLabelText = resolveOversightString(language, primaryKey);

    // Task 13 — `waitingLabel` graduated to founder-approved copy (his own
    // reference-image table). A later founder message (2026-08-23)
    // graduated `restState` the same way (see `oversightTranslations.ts`'s
    // header, category (d), "RESTSTATE GRADUATION"). So the placeholder
    // caption below is driven by `PENDING_FOUNDER_STRINGS.includes(primaryKey)`,
    // not a blanket `language === 'mr'` check — it disappears for either
    // state once that state's key stops being pending, and only ever
    // reappears if a key is added back to `PENDING_FOUNDER_STRINGS`.
    //
    // Finding F7 addendum — the caption exists to show the English BESIDE a
    // Marathi placeholder. A category (c) key (`mr: ''`, e.g.
    // `checkingState`) has no Marathi to sit beside: `resolveOversightString`
    // has already read through to English, so a caption would print the same
    // sentence twice, uppercased. The comparison below is the mechanical
    // form of that rule — it also subsumes the pre-existing
    // `english_mode_does_not_double_up_the_caption` case, which is why the
    // `language === 'mr'` term is kept rather than replaced by it.
    const isPrimaryPending = PENDING_FOUNDER_STRINGS.includes(primaryKey);
    const englishCaption = language === 'mr'
        && isPrimaryPending
        && primaryLabelText !== oversightTranslations.en[primaryKey]
        ? oversightTranslations.en[primaryKey].toUpperCase()
        : null;

    // Task 13 — the founder's reference adds a subtitle line under the
    // (now approved) waiting title. Waiting state only; the rest state
    // carries no subtitle in the founder's table, so this key is never
    // resolved for it.
    const subtitleText = isWaiting ? resolveOversightString(language, 'waitingSubtitle') : null;

    return (
        <button
            type="button"
            onClick={onToggleWaiting}
            data-testid="canonical-strip-waiting-button"
            aria-label={primaryLabelText}
            className={`relative flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                isWaiting
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-stone-200 bg-white'
            }`}
            style={{ minHeight: STRIP_MIN_HEIGHT }}
        >
            {/* The grab handle — "This is what makes it look openable — do
                not omit it." Same position/size in both states; only the
                colour swaps. */}
            <span
                aria-hidden="true"
                data-testid="canonical-strip-tray-handle"
                className={`absolute left-1/2 top-[5px] h-[3px] w-[26px] -translate-x-1/2 rounded-full ${
                    isWaiting ? 'bg-amber-200' : 'bg-stone-200'
                }`}
            />

            {/* FOUR states, one slot, one size — the strip stays a fixed
                landmark (spec §2.2). The checking state is deliberately
                STONE, not emerald: the green tick IS the completion claim
                as far as a farmer reading colour before text is concerned
                (§P-G's own reasoning), so it may not appear until the
                claim is true. Finding F7(a).

                CHANGE 2 — the unknown state shares the checking state's
                STONE treatment on purpose. Colour must carry "we cannot
                say" in both, and stone is already this strip's word for it;
                amber would say "this needs you" (§P-G) about a situation the
                farmer cannot act on, and emerald would say the one thing
                that is not true. Only the GLYPH changes, from a spinner to a
                question mark — motion is what promises "about to resolve",
                so the stillness is the whole point. */}
            <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isWaiting
                        ? 'bg-amber-700 text-white'
                        : (isChecking || isUnknown ? 'bg-stone-100 text-stone-400' : 'bg-emerald-50 text-emerald-600')
                }`}
                data-testid={
                    isWaiting
                        ? 'canonical-strip-waiting-icon'
                        : (isChecking
                            ? 'canonical-strip-waiting-checking-icon'
                            : (isUnknown
                                ? 'canonical-strip-waiting-unknown-icon'
                                : 'canonical-strip-waiting-rest-tick'))
                }
            >
                {isWaiting && <AlertTriangle size={14} strokeWidth={2.25} />}
                {!isWaiting && isChecking && <Loader2 size={15} strokeWidth={2.25} className="animate-spin" />}
                {!isWaiting && isUnknown && <HelpCircle size={16} strokeWidth={2.25} />}
                {!isWaiting && !isChecking && !isUnknown && <CheckCircle2 size={16} strokeWidth={2.25} />}
            </span>

            <span className="min-w-0 flex-1 pt-1">
                <span
                    className={`block truncate text-[13px] font-extrabold leading-tight ${
                        isWaiting
                            ? 'text-amber-900'
                            : (isChecking || isUnknown ? 'text-stone-500' : 'text-stone-800')
                    }`}
                    style={fontStyleFor(primaryLabelText)}
                >
                    {primaryLabelText}
                </span>
                {/* CHANGE 1 — WRAPS, NEVER TRUNCATES.
                    MEASURED in a real browser at deviceScaleFactor 2, with
                    the founder's own Marathi (`waitingSubtitle`, category
                    (d)) and this exact type ramp: the sentence needs ~212px.
                    The slot gives it 246px at 390px wide and 216px at 360px
                    — it fits both — but only 176px at 320px, where
                    `truncate` clipped 36px of it into an ellipsis. A
                    half-sentence ending in "…" is worse than a second line
                    for a semi-literate reader: he loses the words that say
                    what is wanted of him, and gets no signal that anything
                    was removed beyond three dots he may not read as
                    "continues".
                    So: no `truncate`, no `line-clamp` either. A clamp is the
                    same defect deferred to whatever string comes next — it
                    would clip a three-line sentence exactly as `truncate`
                    clipped this one. The bar grows instead; that is the
                    honest trade and it costs ~15px, only at 320px, and only
                    in the waiting state (the rest state carries no subtitle
                    at all, so spec §2.2's "rest state keeps its exact place
                    and size" is untouched).
                    `leading-[1.45]` rather than `leading-tight`: Devanagari
                    carries matras above AND below the line (ि ी ू ृ), which
                    collide between stacked lines at 1.25. This is the first
                    time this string can occupy two lines, so it is the first
                    time the leading matters. */}
                {subtitleText && (
                    <span
                        data-testid="canonical-strip-waiting-subtitle"
                        className="block text-[10.5px] font-semibold leading-[1.45] text-amber-700/70"
                        style={fontStyleFor(subtitleText)}
                    >
                        {subtitleText}
                    </span>
                )}
                {englishCaption && (
                    <span
                        data-testid="canonical-strip-waiting-caption"
                        className={`block truncate text-[9px] font-bold uppercase leading-tight tracking-wide ${
                            isWaiting ? 'text-amber-700/60' : 'text-stone-400'
                        }`}
                        style={ENGLISH_FONT}
                    >
                        {englishCaption}
                    </span>
                )}
            </span>

            {isWaiting && (
                <span
                    data-testid="canonical-strip-waiting-count"
                    className="flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-amber-600 px-1.5 py-0.5 text-xs font-extrabold text-white"
                    style={ENGLISH_FONT}
                >
                    {waitingCount}
                </span>
            )}

            <ChevronDown size={14} className={`shrink-0 ${isWaiting ? 'text-amber-700' : 'text-stone-400'}`} />
        </button>
    );
};

export default CanonicalStrip;
