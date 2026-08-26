/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13)
 *
 * OversightNavCards — replaces `PageToggle`'s segmented Log/Reflect/Compare
 * pill (`shared/components/ui/PageToggle.tsx`, still present but no longer
 * wired into `AppHeader`) with three bigger, more legible cards, per the
 * founder's own reference image (`log screen re design reference.png`) and
 * his own Marathi table: "आजची कामे" / "माझं शेत" / "तुलना", each a rounded
 * card with an icon, sitting in its own row beneath `AppHeader`'s row 1 —
 * see `CanonicalStrip.tsx`'s header comment for the row diagram.
 *
 * Active card: emerald tint (`bg-emerald-50`), emerald text, and a thick
 * emerald underline bar at its base. Inactive: white card, `stone-200`
 * border, stone text. No background pill, no filled state beyond the tint —
 * matches the reference's proportions, deliberately bigger than the old
 * toggle (a founder-stated requirement: "Bigger text is an explicit founder
 * requirement").
 *
 * Icons are `lucide-react` (already the app's icon library everywhere else
 * in this feature — no new dependency): `ClipboardCheck` (today's tasks —
 * the log screen), `Home` (my farm — the reflect/analysis screen), `Scale`
 * (compare). The reference's own icons are bespoke colour illustrations;
 * these are the closest monochrome equivalents in the app's existing icon
 * set, tinted the same way every other icon in this feature already is.
 *
 * Same route list `AppHeader.tsx` previously gated `PageToggle` on
 * (`PAGE_TOGGLE_ROUTES`) — this component itself is route-agnostic (props
 * only); the caller decides when to render it.
 */
import React from 'react';
import { ClipboardCheck, Home, Scale } from 'lucide-react';
import type { PageView } from '../../../types';
import type { Language } from '../../../i18n/language';
import { resolveOversightString, type OversightTranslations } from '../../../i18n/oversightTranslations';
import { hapticFeedback } from '../../../shared/utils/haptics';

// Same font-selection convention every other oversight component uses
// (root CLAUDE.md Font Rules) — picks which of the two locked fonts a
// resolved string needs, never what text renders.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

const NAV_ITEMS: ReadonlyArray<{
    key: PageView;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
    labelKey: keyof OversightTranslations;
}> = [
    { key: 'log', icon: ClipboardCheck, labelKey: 'navToday' },
    { key: 'reflect', icon: Home, labelKey: 'navMyFarm' },
    { key: 'compare', icon: Scale, labelKey: 'navCompare' },
];

export interface OversightNavCardsProps {
    /** Drives every label via `resolveOversightString`. */
    language: Language;
    /** The currently active sub-view — decides which card is tinted. */
    view: PageView;
    /** Fired with the tapped card's `PageView`. */
    onChange: (view: PageView) => void;
    disabled?: boolean;
}

const OversightNavCards: React.FC<OversightNavCardsProps> = ({ language, view, onChange, disabled }) => (
    <div className="grid w-full grid-cols-3 gap-2" data-testid="oversight-nav-cards">
        {NAV_ITEMS.map((item) => {
            const isActive = view === item.key;
            const label = resolveOversightString(language, item.labelKey);
            const Icon = item.icon;

            return (
                <button
                    key={item.key}
                    type="button"
                    data-testid={`oversight-nav-card-${item.key}`}
                    aria-current={isActive ? 'true' : undefined}
                    disabled={disabled}
                    onClick={() => {
                        hapticFeedback.medium();
                        onChange(item.key);
                    }}
                    className={`relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border px-2 py-3 transition-colors duration-200 ${
                        isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
                    }`}
                >
                    <Icon size={20} strokeWidth={2.25} className={isActive ? 'text-emerald-600' : 'text-stone-400'} />
                    <span
                        className="block max-w-full truncate text-center text-[12.5px] font-extrabold leading-tight"
                        style={fontStyleFor(label)}
                    >
                        {label}
                    </span>
                    {isActive && (
                        <span
                            aria-hidden="true"
                            data-testid={`oversight-nav-card-${item.key}-underline`}
                            className="absolute bottom-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-emerald-600"
                        />
                    )}
                </button>
            );
        })}
    </div>
);

export default OversightNavCards;
