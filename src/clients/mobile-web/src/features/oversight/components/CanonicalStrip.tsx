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
 */
import React from 'react';
import { Leaf, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
    onOpenFarmSwitcher,
}) => {
    const plotsUnitText = resolveOversightString(language, 'plotsUnit');
    const plotLine = `${plotCount} ${plotsUnitText}`;
    const isMulti = farmCount >= 2;

    const leafMark = (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-emerald-600 text-white">
            <Leaf size={12} strokeWidth={2.25} fill="white" />
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
                {leafMark}
                <span className="min-w-0">
                    {nameLine('text-stone-800')}
                    {plotLineNode('text-stone-400')}
                </span>
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onOpenFarmSwitcher}
            data-testid="canonical-strip-farm-chip"
            aria-label={`${resolveOversightString(language, 'yourFarms')}: ${farmName} — ${plotLine}`}
            title={farmName}
            className="flex max-w-[178px] shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 py-0.5 pl-1 pr-1.5"
        >
            {leafMark}
            <span className="min-w-0">
                {nameLine('text-emerald-900')}
                {plotLineNode('text-emerald-700/85')}
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
    onToggleWaiting,
}) => {
    const isWaiting = waitingCount > 0;
    const primaryKey = isWaiting ? 'waitingLabel' : 'restState';
    const primaryLabelText = resolveOversightString(language, primaryKey);

    // Task 13 — `waitingLabel` graduated to founder-approved copy (his own
    // reference-image table). A later founder message (2026-08-23)
    // graduated `restState` the same way (see `oversightTranslations.ts`'s
    // header, category (d), "RESTSTATE GRADUATION"). So the placeholder
    // caption below is driven by `PENDING_FOUNDER_STRINGS.includes(primaryKey)`,
    // not a blanket `language === 'mr'` check — it disappears for either
    // state once that state's key stops being pending, and only ever
    // reappears if a key is added back to `PENDING_FOUNDER_STRINGS`.
    const isPrimaryPending = PENDING_FOUNDER_STRINGS.includes(primaryKey);
    const englishCaption = language === 'mr' && isPrimaryPending
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

            <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    isWaiting ? 'bg-amber-700 text-white' : 'bg-emerald-50 text-emerald-600'
                }`}
                data-testid={isWaiting ? 'canonical-strip-waiting-icon' : 'canonical-strip-waiting-rest-tick'}
            >
                {isWaiting
                    ? <AlertTriangle size={14} strokeWidth={2.25} />
                    : <CheckCircle2 size={16} strokeWidth={2.25} />}
            </span>

            <span className="min-w-0 flex-1 pt-1">
                <span
                    className={`block truncate text-[13px] font-extrabold leading-tight ${
                        isWaiting ? 'text-amber-900' : 'text-stone-800'
                    }`}
                    style={fontStyleFor(primaryLabelText)}
                >
                    {primaryLabelText}
                </span>
                {subtitleText && (
                    <span
                        data-testid="canonical-strip-waiting-subtitle"
                        className="block truncate text-[10.5px] font-semibold leading-tight text-amber-700/70"
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
