/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * CanonicalStrip — Task 4 built this as two side-by-side buttons (design
 * doc §2). Task 11 restructures it under a DIRECT FOUNDER INSTRUCTION that
 * supersedes that mock's layout:
 *
 *   Row 1:  [avatar][farm ▾]      [Log | Reflect | Compare]      [weather][gear]
 *   Row 2:  [ oversight / waiting — FULL WIDTH                        N  ⌄ ]
 *
 * The farm chip MOVES UP into row 1, beside the profile avatar — it is no
 * longer part of "the strip" this file renders. This file now owns two
 * SEPARATE pieces:
 *
 *   `CompactFarmChip` (named export) — row 1's farm-identity trigger: leaf
 *   mark + chevron, a fixed 44×44px tap target, no visible name or plot
 *   count. MEASURED (task-11 report, this component's own header comment
 *   has the full account): a hard-truncated-name variant was tried first
 *   and left the centre `PageToggle` too narrow — its labels visually
 *   collided in a real Playwright render at 390×844. This is the task-11
 *   brief's explicitly-allowed SECOND compression option ("name truncated
 *   hard OR dropped entirely"). Nothing is lost: both the name and the
 *   plot count reach this chip's `aria-label`/`title`, never fabricated,
 *   never silently dropped — and the full name is already shown inside the
 *   `FarmSwitcherSheet` this chip opens (spec §2.1).
 *
 *   `CanonicalStrip` (default export) — row 2, now the WAITING BUTTON
 *   ALONE, full width. Every Task-4 locked behaviour that concerns the
 *   waiting button is UNCHANGED: rest-state keeps its exact place/height
 *   (`min-h-[52px]`), `waitingCount` is a prop read straight off
 *   `OversightModel` (never a literal), the §P-G colour rule (amber
 *   waiting / never-emerald), and every string via
 *   `resolveOversightString()` (`oversightTranslations.ts`) only. Only the
 *   farm chip's sibling markup is gone from this component.
 *
 * Both presentational only — props in, markup out. No data fetching, no
 * Dexie, no hooks that read storage.
 */
import React from 'react';
import { Leaf, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Language } from '../../../i18n/language';
import { oversightTranslations, resolveOversightString } from '../../../i18n/oversightTranslations';

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

export interface CompactFarmChipProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /** Current farm's display name — carried in `aria-label`/`title`, not
     * visible text (see MEASURED note below). */
    farmName: string;
    /**
     * Current farm's plot count. Not rendered as visible text either —
     * carried through `aria-label` only, so it is never fabricated and
     * never silently dropped from the accessible name.
     */
    plotCount: number;
    /** Opens the existing `FarmSwitcherSheet` unchanged (spec §2.1). */
    onOpenFarmSwitcher: () => void;
}

/**
 * Row 1's farm-identity trigger (task-11 brief, founder instruction: "The
 * farm switcher moves up beside the profile circle"). Opens the SAME
 * `FarmSwitcherSheet` unchanged — only this trigger's shell is new/smaller.
 *
 * MEASURED (task-11 report — do not revert without re-measuring): the first
 * attempt kept a hard-truncated name span (leaf + ~4 visible characters +
 * chevron, ~76px). At 390×844 that left the centre `PageToggle` only
 * ~128px, and a real Playwright render showed its three labels visually
 * COLLIDING ("LOGREFLECTCOMPARE" overlapping) — a cramped, broken header,
 * which the brief explicitly ranks as worse than reporting a non-fit. The
 * toggle's own un-wrappable content needs ~154–165px (measured via
 * `scrollWidth`), so the farm chip drops the name from VISIBLE text
 * entirely — the task-11 brief's explicitly-allowed second compression
 * option ("name truncated hard OR dropped entirely"). The name is not
 * lost: it is in `aria-label`/`title` here, and the full name is already
 * shown inside the `FarmSwitcherSheet` this chip opens (spec §2.1).
 */
export const CompactFarmChip: React.FC<CompactFarmChipProps> = ({
    language,
    farmName,
    plotCount,
    onOpenFarmSwitcher,
}) => {
    const plotsUnitText = resolveOversightString(language, 'plotsUnit');

    return (
        <button
            type="button"
            onClick={onOpenFarmSwitcher}
            data-testid="canonical-strip-farm-chip"
            aria-label={`${resolveOversightString(language, 'yourFarms')}: ${farmName} — ${plotCount} ${plotsUnitText}`}
            title={farmName}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50"
        >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                <Leaf size={13} strokeWidth={2.25} fill="white" />
            </span>
            <ChevronDown size={11} className="ml-px shrink-0 text-emerald-700" />
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
 * Row 2 — the waiting button, alone, full width (task-11 founder
 * instruction). Spec §2.2's locked behaviours all still apply to this one
 * button: same place/height in both states, colour carries the two-axis
 * rule (§P-G), copy from `oversightTranslations.ts` only.
 */
const CanonicalStrip: React.FC<CanonicalStripProps> = ({
    language,
    waitingCount,
    onToggleWaiting,
}) => {
    const isWaiting = waitingCount > 0;
    const primaryLabelText = resolveOversightString(language, isWaiting ? 'waitingLabel' : 'restState');

    // `waitingLabel`/`restState` are agent placeholders, not yet
    // founder-approved copy (spec §6.2, `PENDING_FOUNDER_STRINGS`). The
    // house pattern for "Marathi CTA + a small English caption beneath" is
    // already shipped (`FarmContextSwitcher.tsx`'s footer buttons) — reused
    // here so the un-approved string visibly reads as a placeholder rather
    // than signed-off copy. Only shown when the resolved primary text is
    // itself Marathi; when `language` is 'en' the primary line already IS
    // this text, so a second copy would just be a literal duplicate.
    const englishCaption = language === 'mr'
        ? oversightTranslations.en[isWaiting ? 'waitingLabel' : 'restState'].toUpperCase()
        : null;

    return (
        <button
            type="button"
            onClick={onToggleWaiting}
            data-testid="canonical-strip-waiting-button"
            aria-label={primaryLabelText}
            className={`flex w-full items-center gap-2 rounded-2xl border px-3 py-1.5 text-left transition-colors ${
                isWaiting
                    ? 'border-amber-700 bg-amber-600'
                    : 'border-stone-200 bg-white'
            }`}
            style={{ minHeight: STRIP_MIN_HEIGHT }}
        >
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

            <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-[13px] font-extrabold leading-tight ${
                        isWaiting ? 'text-white' : 'text-stone-800'
                    }`}
                    style={fontStyleFor(primaryLabelText)}
                >
                    {primaryLabelText}
                </span>
                {englishCaption && (
                    <span
                        data-testid="canonical-strip-waiting-caption"
                        className={`block truncate text-[9px] font-bold uppercase leading-tight tracking-wide ${
                            isWaiting ? 'text-amber-50/80' : 'text-stone-400'
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
                    className="flex min-w-[22px] shrink-0 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-xs font-extrabold text-amber-700"
                    style={ENGLISH_FONT}
                >
                    {waitingCount}
                </span>
            )}

            <ChevronDown size={14} className={`shrink-0 ${isWaiting ? 'text-white' : 'text-stone-400'}`} />
        </button>
    );
};

export default CanonicalStrip;
