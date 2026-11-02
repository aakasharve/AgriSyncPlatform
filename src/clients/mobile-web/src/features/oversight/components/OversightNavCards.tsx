/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 13)
 *
 * OversightNavCards — replaces `PageToggle`'s segmented Log/Reflect/Compare
 * pill (`shared/components/ui/PageToggle.tsx`, still present but no longer
 * wired into `AppHeader`) with three bigger, more legible cards, sitting in
 * their own row beneath `AppHeader`'s row 1 — see `CanonicalStrip.tsx`'s
 * header comment for the row diagram.
 *
 * Founder-approved 2026-10-25 ("trial v3"). This row is the page switcher, the
 * hero of the header, so it must be impossible to misread:
 *   - the card you are on is SOLID green with white icon and words; the other
 *     two are white with grey icons (no guessing which page is open);
 *   - icons 26px in a pill, words 13.5px;
 *   - a tap answers at once: the card presses in, a ripple spreads from the
 *     finger, and the newly chosen card's icon pill pops.
 * The words: "आजची कामे" / "पूर्ण शेतीचा आढावा" (it used to be "माझं शेत") /
 * "तुलना". Icons are `lucide-react`: `ClipboardCheck`, `Map` (the whole farm),
 * `Scale`. The longer middle label may take two lines; every card keeps the
 * same height.
 *
 * Same route list `AppHeader.tsx` previously gated `PageToggle` on
 * (`PAGE_TOGGLE_ROUTES`) — this component itself is route-agnostic (props
 * only); the caller decides when to render it.
 */
import React from 'react';
import { ClipboardCheck, Map as MapIcon, Scale } from 'lucide-react';
import type { PageView } from '../../../types';
import type { Language } from '../../../i18n/language';
import { resolveOversightString, type OversightTranslations } from '../../../i18n/oversightTranslations';
import { hapticFeedback } from '../../../shared/utils/haptics';
import { plotScopeCopy } from '../../profile/team/plotScopeCopy';

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
    icon: typeof ClipboardCheck;
    labelKey: keyof OversightTranslations;
}> = [
    { key: 'log', icon: ClipboardCheck, labelKey: 'navToday' },
    { key: 'reflect', icon: MapIcon, labelKey: 'navMyFarm' },
    { key: 'compare', icon: Scale, labelKey: 'navCompare' },
];

export interface OversightNavCardsProps {
    /** Drives every label via `resolveOversightString`. */
    language: Language;
    /** The currently active sub-view — decides which card is solid green. */
    view: PageView;
    /** Fired with the tapped card's `PageView`. */
    onChange: (view: PageView) => void;
    disabled?: boolean;
    /** Pages this person may not open (founder 2026-10-25: a worker gets no तुलना). The rest share the row. Default: none hidden. */
    hiddenViews?: readonly PageView[];
    /**
     * spec: plr-d10 lane MU-4 — this person covers CHOSEN plots on the open farm: the overview shows only his plots, so
     * its card must not say "पूर्ण शेती" to him (`plotScopeCopy.overviewTitle`, PROPOSED).
     */
    plotsOnly?: boolean;
}

const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

interface Ripple { key: PageView; x: number; y: number; size: number; id: number }

const OversightNavCards: React.FC<OversightNavCardsProps> = ({ language, view, onChange, disabled, hiddenViews, plotsOnly }) => {
    const items = hiddenViews?.length ? NAV_ITEMS.filter(i => !hiddenViews.includes(i.key)) : NAV_ITEMS;
    const [ripple, setRipple] = React.useState<Ripple | null>(null);
    const startRipple = (key: PageView, e: React.PointerEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setRipple({ key, x: e.clientX - r.left, y: e.clientY - r.top, size: Math.max(r.width, r.height) * 2.2, id: Date.now() });
    };
    return (
        <div className={`grid w-full ${GRID_COLS[items.length]} gap-2`} data-testid="oversight-nav-cards">
            {items.map((item) => {
                const isActive = view === item.key;
                const label = plotsOnly && item.key === 'reflect'
                    ? plotScopeCopy(language).overviewTitle
                    : resolveOversightString(language, item.labelKey);
                const Icon = item.icon;

                return (
                    <button
                        key={item.key}
                        type="button"
                        data-testid={`oversight-nav-card-${item.key}`}
                        aria-current={isActive ? 'true' : undefined}
                        disabled={disabled}
                        onPointerDown={(e) => startRipple(item.key, e)}
                        onClick={() => {
                            hapticFeedback.medium();
                            onChange(item.key);
                        }}
                        className={`relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border px-1.5 py-2.5 transition-[transform,background-color,box-shadow] duration-200 active:scale-[0.96] ${
                            isActive
                                ? 'border-emerald-700 bg-gradient-to-b from-emerald-600 to-emerald-700 text-white shadow-[0_6px_14px_-6px_rgba(4,120,87,0.6)]'
                                : 'border-stone-200 bg-white text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.06)] hover:bg-stone-50'
                        }`}
                    >
                        {ripple?.key === item.key && (
                            <span
                                key={ripple.id}
                                aria-hidden="true"
                                data-testid="nav-card-ripple"
                                className="pointer-events-none absolute animate-nav-ripple rounded-full"
                                style={{
                                    left: ripple.x - ripple.size / 2, top: ripple.y - ripple.size / 2, width: ripple.size, height: ripple.size,
                                    background: isActive ? 'rgba(255,255,255,0.35)' : 'rgba(16,185,129,0.22)',
                                }}
                            />
                        )}
                        <span
                            key={isActive ? 'on' : 'off'}
                            data-active-pill={isActive ? 'yes' : 'no'}
                            className={`relative grid h-9 w-16 place-items-center rounded-full ${isActive ? 'animate-plr-pop bg-white/20 text-white' : 'bg-stone-100 text-stone-600'}`}
                        >
                            <Icon size={26} strokeWidth={isActive ? 2.4 : 2.1} aria-hidden="true" data-nav-icon={item.key} />
                        </span>
                        <span
                            className={`relative line-clamp-2 block max-w-full text-center text-[13.5px] leading-tight ${isActive ? 'font-extrabold text-white' : 'font-bold text-stone-700'}`}
                            style={fontStyleFor(label)}
                        >
                            {label}
                        </span>
                        {isActive && (
                            <span
                                aria-hidden="true"
                                data-testid={`oversight-nav-card-${item.key}-underline`}
                                className="absolute bottom-0 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-white/80"
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default OversightNavCards;
