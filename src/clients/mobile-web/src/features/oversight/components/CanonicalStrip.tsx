/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * CanonicalStrip — Task 4 (design doc §2, "THE CANONICAL STRIP").
 *
 * Two side-by-side buttons with a gap between them — deliberately NOT one
 * split bar with a divider: two shapes read as two things faster than one
 * bar, which matters most for someone not reading the words (spec §2).
 *
 *   Farm chip (left, emerald, ~135px)   — WHERE. Identity/context.
 *   Waiting button (right, amber, flex:1) — WHAT NEEDS YOU. ~1.8x the farm
 *     chip's width because it is the only one carrying information — the
 *     label is what makes the count mean something (spec §2.2).
 *
 * Presentational only — props in, markup out. No data fetching, no Dexie,
 * no hooks that read storage: `language` and every count are supplied by
 * the caller (a later task wires this into `AppHeader`, fed by
 * `buildOversightModel`, `../../oversightSelectors.ts`).
 *
 * LOCKED BEHAVIOURS this file is responsible for:
 *  - The waiting button keeps its exact position AND height whether it is
 *    showing the amber "waiting" state or the white/green "rest" state
 *    (spec §2.2: "Rest state keeps its exact place and size ... The layout
 *    never reshuffles, so the strip is a fixed landmark"). Both states
 *    render the same `min-h-[52px]` button; only its contents change.
 *  - `waitingCount` is a prop, read straight off `OversightModel`, never a
 *    literal written in this file (task brief, binding constraint 2).
 *  - Colour carries the two-axis rule (spec §P-G): `bg-emerald-600` already
 *    means "Approve" elsewhere in this app (`ReviewInbox.tsx:97`,
 *    `AttentionCard.tsx:121`), so emerald is confined here to the farm chip
 *    (identity) and the rest-state tick (spec §2.2 explicitly allows a
 *    green tick at rest) — the amber/waiting state itself is NEVER
 *    emerald.
 *  - Every farmer-facing string comes from `oversightTranslations.ts`
 *    (Task 3) via `resolveOversightString()`, never an invented literal
 *    (spec §6, the Marathi Hard Rule).
 */
import React from 'react';
import { Leaf, ChevronDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Language } from '../../../i18n/language';
import { oversightTranslations, resolveOversightString } from '../../../i18n/oversightTranslations';

export interface CanonicalStripProps {
    /** Drives every string in this component via `resolveOversightString`. */
    language: Language;
    /** Current farm's display name — the farm chip's primary line. */
    farmName: string;
    /** Current farm's plot count — the farm chip's secondary line. */
    plotCount: number;
    /**
     * `OversightModel.waitingCount` (`oversightSelectors.ts`), derived from
     * real records. A numeric literal here anywhere is a defect.
     */
    waitingCount: number;
    /** Opens the existing `FarmSwitcherSheet` unchanged (spec §2.1). */
    onOpenFarmSwitcher: () => void;
    /** Opens the waiting drawer (spec §3). */
    onToggleWaiting: () => void;
}

// Devanagari block. Used only to pick which of the two locked fonts a
// resolved string needs (root CLAUDE.md Font Rules) — never to decide
// *what* text renders, which is `resolveOversightString()`'s job alone.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

// Spec §2: "both 52px tall (above the 44px minimum)". One constant so the
// waiting button's two states can never drift from each other or from the
// farm chip.
const STRIP_MIN_HEIGHT = '52px';

const CanonicalStrip: React.FC<CanonicalStripProps> = ({
    language,
    farmName,
    plotCount,
    waitingCount,
    onOpenFarmSwitcher,
    onToggleWaiting,
}) => {
    const isWaiting = waitingCount > 0;

    const plotsUnitText = resolveOversightString(language, 'plotsUnit');
    const primaryLabelText = resolveOversightString(language, isWaiting ? 'waitingLabel' : 'restState');

    // `waitingLabel`/`restState` are agent placeholders, not yet
    // founder-approved copy (spec §6.2, `PENDING_FOUNDER_STRINGS`). The
    // house pattern for "Marathi CTA + a small English caption beneath" is
    // already shipped (`FarmContextSwitcher.tsx`'s footer buttons, lines
    // 235–256) — reused here so the un-approved string visibly reads as a
    // placeholder rather than signed-off copy. Only shown when the
    // resolved primary text is itself Marathi; when `language` is 'en' the
    // primary line already IS this text, so a second copy would just be a
    // literal duplicate.
    const englishCaption = language === 'mr'
        ? oversightTranslations.en[isWaiting ? 'waitingLabel' : 'restState'].toUpperCase()
        : null;

    return (
        <div className="flex items-center gap-2">
            {/* Farm chip — WHERE. Spec §2.1: opens the existing
                FarmSwitcherSheet unchanged; only this trigger's shell is new. */}
            <button
                type="button"
                onClick={onOpenFarmSwitcher}
                data-testid="canonical-strip-farm-chip"
                aria-label={`${resolveOversightString(language, 'yourFarms')}: ${farmName}`}
                className="flex w-[135px] shrink-0 items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-left"
                style={{ minHeight: STRIP_MIN_HEIGHT }}
            >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <Leaf size={14} strokeWidth={2.25} fill="white" />
                </span>
                <span className="min-w-0 flex-1">
                    <span
                        className="block truncate text-[13px] font-extrabold leading-tight text-emerald-800"
                        style={fontStyleFor(farmName)}
                    >
                        {farmName}
                    </span>
                    <span
                        className="block truncate text-[10px] font-semibold leading-tight text-emerald-700"
                        style={fontStyleFor(plotsUnitText)}
                    >
                        {plotCount} {plotsUnitText}
                    </span>
                </span>
                <ChevronDown size={14} className="shrink-0 text-emerald-700" />
            </button>

            {/* Waiting button — WHAT NEEDS YOU. Spec §2.2: same position and
                height in both states (locked behaviour 1). */}
            <button
                type="button"
                onClick={onToggleWaiting}
                data-testid="canonical-strip-waiting-button"
                aria-label={primaryLabelText}
                className={`flex flex-1 items-center gap-2 rounded-2xl border px-3 py-1.5 text-left transition-colors ${
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
        </div>
    );
};

export default CanonicalStrip;
