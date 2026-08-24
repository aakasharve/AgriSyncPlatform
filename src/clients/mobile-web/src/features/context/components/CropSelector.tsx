/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { Layers, CheckCircle2, MapPin, Home, ChevronRight } from 'lucide-react';
import { CropProfile } from '../../../types';
import { getCropTheme } from '../../../shared/utils/colorTheme';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { resolveOversightString } from '../../../i18n/oversightTranslations';

// Same font-selection convention every oversight component uses (root
// CLAUDE.md Font Rules) — only used below when `hideGlobalCard` opts a
// caller into the founder-approved Task 13 copy.
const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
const MARATHI_BODY_FONT = { fontFamily: "'Noto Sans Devanagari', sans-serif" } as const;
const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;
function fontStyleFor(text: string): React.CSSProperties {
    return DEVANAGARI_PATTERN.test(text) ? MARATHI_BODY_FONT : ENGLISH_FONT;
}

interface CropSelectorProps {
    mode: 'log' | 'reflect';
    crops: CropProfile[];
    selectedCrops: string[];
    selectedPlots: Record<string, string[]>;
    onSelectionChange: (crops: string[], plots: Record<string, string[]>) => void;
    disabled?: boolean;
    compact?: boolean;
    showPlots?: boolean; // New prop to force plot display in compact mode
    /**
     * THE OPT-IN FOR EVERY FOUNDER-DIRECTED LOG-SCREEN CHANGE ON THIS
     * COMPONENT. `mainView.tsx`'s log screen is the only caller that sets it.
     *
     * spec: owner-oversight-loop. §5.1 is explicit that `CropSelector` is not
     * to be redesigned, so nothing here may reach a consumer that has not
     * asked for it. When `true`:
     *   - Task 13, change 4 — the "Entire Farm" card is suppressed from the
     *     horizontal carousel (it no longer sits first, equal-weight with the
     *     crops); the SAME selection (`handleGlobalToggle`/`isGlobalSelected`
     *     below — unchanged logic, not re-implemented) instead renders as a
     *     quiet, full-width list row BELOW the crop cards;
     *   - Task 13, change 4 — the `mode === 'log'` section header/hint swap
     *     from this component's original English dev copy to the founder's
     *     own approved Marathi (`oversightTranslations.ts`'s
     *     `plotSectionHeader` / `plotSectionHint`);
     *   - Task 16, Problem 2 — the founder-directed VIVID selected state on
     *     the crop cards: `strongFill` + `ring-[4px]` instead of the `-50`
     *     tint + `ring-[3px]`, a deeper shadow, a harder dim on unselected
     *     siblings, an opaquer count pill and a larger tick badge with a
     *     solid white border. He approved this on the log screen and
     *     re-approved it since; it belongs there and only there.
     *
     * WHAT `false`/OMITTED GUARANTEES, AND WHAT IT DOES NOT (finding F5).
     * Every VISIBLE difference listed above is gated, so `Attendance.tsx` —
     * the one other consumer, which never passes this prop — renders the
     * same pixels it rendered before this branch. Pinned class-by-class in
     * `__tests__/CropSelectorDefaultPath.test.tsx`.
     *
     * It is NOT byte-identical, and the earlier version of this comment
     * claiming so was false. Two non-visual additions apply on BOTH paths and
     * are deliberate: `data-testid` hooks (`crop-card-*`, `crop-tick-*`,
     * `crop-selector-entire-farm-row*`, `plot-tray-button`) and
     * `aria-pressed` on the crop cards — the latter an accessibility fix for
     * a control that has always been a toggle, and the reason the default
     * path can now be tested by rendered output at all.
     */
    hideGlobalCard?: boolean;
}

// --- NEW COMPONENT: CropSymbol (Photo/Emoji Replacement) ---
export const CropSymbol = ({ name, size = 'lg' }: { name: string, size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) => {
    // Map internal icon names to Real Images
    const getImage = (n: string) => {
        // Normalize name to handle potential variations
        const normalized = n.toLowerCase();

        if (normalized.includes('grape')) return '/images/crops/Black Grapes.jpg';
        if (normalized.includes('sugar')) return '/images/crops/Sugarcane.jpg';
        if (normalized.includes('onion')) return '/images/crops/Onion.jpg';
        // Corrected spelling and added robust check
        if (normalized.includes('pomegranate') || normalized.includes('pomo')) return '/images/crops/Pomegranate.jpg';
        if (normalized.includes('wheat')) return '/images/crops/Wheat Grain.jpg';
        if (normalized.includes('guava')) return '/images/crops/Guava.jpg';
        if (normalized.includes('tomato')) return '/images/crops/Tomato.jpg';

        // Fallback for Entire Farm / Warehouse
        if (normalized.includes('warehouse') || normalized.includes('farm')) {
            // No generic farm image yet, use emoji fallback
            return null;
        }

        return null; // Fallback to emoji
    };

    const imageUrl = getImage(name);

    // Size mappings for Image
    const imgSizeClass =
        size === 'xs' ? 'w-4 h-4' :
            size === 'sm' ? 'w-6 h-6' :
                size === 'md' ? 'w-10 h-10' :
                    size === 'lg' ? 'w-16 h-16' : 'w-20 h-20';

    // Size mappings for Emoji Fallback
    const fontSize =
        size === 'xs' ? 'text-xs' :
            size === 'sm' ? 'text-sm' :
                size === 'md' ? 'text-xl' :
                    size === 'lg' ? 'text-3xl' : 'text-4xl';

    if (imageUrl) {
        return (
            <>
                <img
                    src={imageUrl}
                    alt={name}
                    className={`${imgSizeClass} rounded-full object-cover select-none shadow-sm`}
                    onError={(e) => {
                        // Fallback to emoji on error (hide image, show sibling span)
                        e.currentTarget.style.display = 'none';
                        const emojiSpan = e.currentTarget.nextElementSibling as HTMLElement;
                        if (emojiSpan) emojiSpan.classList.remove('hidden');
                    }}
                />
                {/* Fallback Emoji (Hidden by default if image loads) */}
                <span className={`${fontSize} leading-none filter drop-shadow-sm select-none hidden`} role="img" aria-label={name}>
                    {getSymbolFallback(name)}
                </span>
            </>
        );
    }

    return (
        <span className={`${fontSize} leading-none filter drop-shadow-sm select-none`} role="img" aria-label={name}>
            {getSymbolFallback(name)}
        </span>
    );
};

// Extracted for reuse
const getSymbolFallback = (n: string) => {
    switch (n) {
        case 'Grape': return '🍇';
        case 'Sugarcane': return '🎋';
        case 'Cotton': return '☁️';
        case 'Wheat': return '🌾';
        case 'Onion': return '🧅';
        case 'Sprout': return '🌱';
        case 'Flower2': return '🌻';
        case 'Trees': return '🌳';
        case 'Warehouse': return '🏡';
        default: return '🌱';
    }
};

// Visual Helper for Plot Markers - EXPORTED
export const PlotMarker = ({ index, colorClass, size = 'normal' }: { index: number, colorClass: string, size?: 'small' | 'normal' }) => {
    const textClass = colorClass.replace('bg-', 'text-');
    const dotSize = size === 'small' ? 'text-xs' : 'text-lg';
    const numSize = size === 'small' ? 'text-[8px]' : 'text-[10px]';

    return (
        <div className="flex items-start leading-none mr-1.5 shrink-0">
            <span className={`${dotSize} ${textClass}`}>●</span>
            <span className={`${numSize} font-bold ${textClass} -mt-0.5 ml-px`}>{index + 1}</span>
        </div>
    );
};

const CropSelector: React.FC<CropSelectorProps> = ({
    mode,
    crops,
    selectedCrops,
    selectedPlots,
    onSelectionChange,
    disabled,
    compact = false,
    showPlots = false,
    hideGlobalCard = false
}) => {
    // Finding F5 — `useLanguage()` THROWS outside `LanguageProvider`
    // (`i18n/LanguageContext.tsx`). Calling it unconditionally here gave a
    // component that previously had NO provider dependency a hard one, for
    // every consumer, in service of copy only the `hideGlobalCard` path
    // renders. `useOptionalLanguage` asks without throwing.
    //
    // The `'en'` fallback is the app's OWN default, not a new guess:
    // `LanguageProvider` itself starts at `useUiPref<Language>(
    // 'agrilog_language', 'en')`. It is also unreachable on the default
    // path — every `resolveOversightString(language, ...)` call below sits
    // inside a `hideGlobalCard` branch, so a consumer outside a provider
    // renders no language-driven string at all.
    const languageContext = useOptionalLanguage();
    const language: Language = languageContext?.language ?? 'en';

    const handleGlobalToggle = () => {
        if (disabled) return;
        const isSelected = selectedCrops.includes('FARM_GLOBAL');

        if (mode === 'log') {
            if (isSelected) {
                onSelectionChange([], {});
            } else {
                onSelectionChange(['FARM_GLOBAL'], {});
            }
        } else {
            let newCrops = [...selectedCrops];
            if (isSelected) {
                newCrops = newCrops.filter(id => id !== 'FARM_GLOBAL');
            } else {
                newCrops.push('FARM_GLOBAL');
            }
            onSelectionChange(newCrops, selectedPlots);
        }
    };

    const handleCropToggle = (crop: CropProfile) => {
        if (disabled) return;

        let newCrops = [...selectedCrops];
        let newPlots = { ...selectedPlots };

        if (mode === 'log' && newCrops.includes('FARM_GLOBAL')) {
            newCrops = [];
            newPlots = {};
        }

        const isSelected = newCrops.includes(crop.id);

        if (mode === 'log') {
            if (isSelected) {
                newCrops = newCrops.filter(id => id !== crop.id);
                delete newPlots[crop.id];
            } else {
                newCrops.push(crop.id);
                // User requirement: User must manually select the plot. Do not auto-select.
                newPlots[crop.id] = [];
            }
        } else {
            if (isSelected) {
                newCrops = newCrops.filter(id => id !== crop.id);
                delete newPlots[crop.id];
            } else {
                newCrops.push(crop.id);
                // In reflect mode, we don't auto-select plots, we let user drill down
                newPlots[crop.id] = [];
            }
        }

        onSelectionChange(newCrops, newPlots);
    };

    const handlePlotToggle = (cropId: string, plotId: string) => {
        if (disabled) return;

        let newCrops = [...selectedCrops];
        if (!newCrops.includes(cropId)) newCrops.push(cropId);

        if (mode === 'log' && newCrops.includes('FARM_GLOBAL')) {
            newCrops = newCrops.filter(id => id !== 'FARM_GLOBAL');
        }

        const currentPlots = selectedPlots[cropId] || [];
        const isSelected = currentPlots.includes(plotId);
        let newCropPlots;

        if (isSelected) {
            newCropPlots = currentPlots.filter(id => id !== plotId);
        } else {
            newCropPlots = [...currentPlots, plotId];
        }

        onSelectionChange(newCrops, { ...selectedPlots, [cropId]: newCropPlots });
    };

    const isGlobalSelected = selectedCrops.includes('FARM_GLOBAL');

    const fontSize = compact ? 'text-xs' : 'text-lg';
    const minHeight = compact ? 'auto' : (mode === 'log' ? '140px' : 'auto');

    return (
        <div className="w-full space-y-4">

            {/* Header */}
            {!compact && (
                <div className="flex items-center justify-between mb-1 px-1">
                    <label className="text-xl font-bold text-slate-800 flex items-center">
                        {mode === 'log' ? (
                            <div className="flex flex-col">
                                <span className="flex items-center" style={hideGlobalCard ? fontStyleFor(resolveOversightString(language, 'plotSectionHeader')) : undefined}>
                                    <MapPin className="mr-2 text-emerald-600 animate-bounce" size={24} />
                                    {hideGlobalCard
                                        ? resolveOversightString(language, 'plotSectionHeader')
                                        : 'Select the plots you worked on today'}
                                </span>
                                <span className="text-xs font-normal text-slate-500 mt-1 pl-8" style={hideGlobalCard ? fontStyleFor(resolveOversightString(language, 'plotSectionHint')) : undefined}>
                                    {hideGlobalCard
                                        ? resolveOversightString(language, 'plotSectionHint')
                                        : 'You can select multiple crops or multiple plots where same work was executed'}
                                </span>
                            </div>
                        ) : (
                            <>
                                <Layers className="mr-2 text-emerald-600" size={20} />
                                Filter by Crop
                            </>
                        )}
                    </label>
                    {selectedCrops.length > 0 && mode === 'reflect' && (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase tracking-wider">
                            {selectedCrops.length} Selected
                        </span>
                    )}
                </div>
            )}

            {/* --- HORIZONTAL CROP SCROLL (BANNER) --- */}
            <div className={`
                flex overflow-x-auto pb-8 pt-4 px-4 snap-x snap-mandatory scrollbar-hide -mx-4 sm:mx-0
                ${compact ? 'gap-4' : 'gap-6'}
            `}>
                {/* 1. Global / Farm Card — spec: owner-oversight-loop (Task
                    13, change 4): "must be visually secondary". Suppressed
                    here when `hideGlobalCard` is set; the SAME selection
                    (`handleGlobalToggle`/`isGlobalSelected`, unchanged)
                    renders instead as a quiet list row below the carousel —
                    see that block, after the crop cards. */}
                {!compact && !hideGlobalCard && (
                    <button
                        onClick={handleGlobalToggle}
                        disabled={disabled}
                        className={`
                            relative flex-shrink-0 flex flex-col items-center pt-4 pb-6 px-2 rounded-[2.5rem] transition-all duration-300 group snap-center
                            ${compact ? 'w-28' : 'w-36'}
                            ${isGlobalSelected
                                ? 'bg-white ring-4 ring-slate-800 shadow-xl scale-105 z-10'
                                : 'bg-white ring-1 ring-slate-100 shadow-sm hover:shadow-md hover:scale-105 opacity-90 hover:opacity-100'}
                        `}
                        style={{ minHeight: minHeight }}
                    >
                        {/* Image Container */}
                        <div className={`
                            relative z-10 mb-3
                            ${compact ? 'w-16 h-16' : 'w-20 h-20'}
                        `}>
                            <div className="relative w-full h-full bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 shadow-inner">
                                <CropSymbol name="Warehouse" size={compact ? 'md' : 'xl'} />
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-1 w-full">
                            <span className={`font-black ${fontSize} leading-tight text-center text-slate-800`}>
                                Entire Farm
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                Overview
                            </span>
                        </div>

                        {/* Hanging Checkmark Badge */}
                        {isGlobalSelected && (
                            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-20 bg-slate-800 rounded-full p-2 shadow-lg ring-4 ring-white animate-in zoom-in duration-300">
                                <CheckCircle2 size={20} className="text-white" strokeWidth={4} />
                            </div>
                        )}
                    </button>
                )}

                {/* 2. Crop Cards */}
                {crops.map((crop) => {
                    const isSelected = selectedCrops.includes(crop.id);
                    const hasMultiplePlots = crop.plots.length > 1;
                    const selectedPlotCount = selectedPlots[crop.id]?.length || 0;

                    // Use safe theme helper
                    const theme = getCropTheme(crop.color);

                    // Focus Mode: If something is selected, dim the others
                    const isFocusMode = selectedCrops.length > 0;
                    const isDimmed = isFocusMode && !isSelected;

                    // ---- FINDING F5: the vivid treatment is OPT-IN ----
                    // The founder directed the vivid selected state (Task 16,
                    // Problem 2: "the user must be able to know what he
                    // selected") and approved it ON THE LOG SCREEN. It shipped
                    // ungated, so `Attendance.tsx` — a screen he never looked
                    // at — inherited it too. Spec §5.1 ("CropSelector is not to
                    // be redesigned") makes that a scope defect, not a taste
                    // one. Each pair below is: [opted-in] / [exactly what main
                    // rendered before this branch].
                    const selectedCardClass = hideGlobalCard
                        ? `${theme.strongFill} ring-[4px] ${theme.border} shadow-[0_20px_50px_-12px_rgba(0,0,0,0.35)] ${theme.slideShadow} scale-110 z-20`
                        : `${theme.slideBgSelected} ring-[3px] ${theme.border} shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)] ${theme.slideShadow} scale-110 z-20`;
                    const dimmedClass = hideGlobalCard
                        ? 'opacity-40 grayscale scale-90'
                        : 'opacity-50 grayscale-[0.8] scale-95';
                    // The photo ring. Opted-in matches the outer ring's
                    // strength (both at the theme's full `-500` intensity /
                    // `strongFill`); the default keeps main's pale `-100`
                    // border over the `-50` tint. The `border` width token
                    // moved out of the static class list into BOTH default
                    // branches — same tokens, same computed style, and it
                    // keeps `border`/`border-2` from ever co-existing on one
                    // element (where the winner would depend on stylesheet
                    // order, not on this file).
                    const photoRingClass = hideGlobalCard
                        ? (isSelected ? `border-2 ${theme.border} ${theme.strongFill}` : 'border border-slate-100 bg-slate-50')
                        : (isSelected ? `border ${theme.slideBorder} ${theme.slideBgSelected}` : 'border border-slate-100 bg-slate-50');
                    const countPillClass = hideGlobalCard
                        ? `${theme.iconText} bg-white/90 px-2.5 py-1 rounded-full shadow-sm`
                        : `${theme.iconText} bg-white/60 px-2 py-0.5 rounded-full`;
                    // Tick badge: larger, with a solid white border (was a
                    // near-invisible border-white/20) so it reads as a crisp
                    // filled disc rather than a soft blob.
                    const tickBadgeClass = hideGlobalCard
                        ? `absolute -bottom-6 left-1/2 -translate-x-1/2 z-30 ${theme.indicator} text-white rounded-full p-2.5 shadow-2xl border-2 border-white ring-2 ring-white/70 animate-in zoom-in spin-in-12 duration-300`
                        : `absolute -bottom-5 left-1/2 -translate-x-1/2 z-30 ${theme.indicator} text-white rounded-full p-2 shadow-xl border border-white/20 ring-2 ring-white/50 animate-in zoom-in spin-in-12 duration-300`;
                    const tickIconSize = hideGlobalCard ? 28 : 24;

                    return (
                        <button
                            key={crop.id}
                            data-testid={`crop-card-${crop.id}`}
                            aria-pressed={isSelected}
                            onClick={() => handleCropToggle(crop)}
                            disabled={disabled}
                            className={`
                                relative flex-shrink-0 flex flex-col items-center pt-4 pb-6 px-2 rounded-[2.5rem] transition-all duration-500 group snap-center overflow-visible
                                ${compact ? 'w-28' : 'w-36'}
                                ${isSelected
                                    ? selectedCardClass
                                    : `bg-white ring-1 ring-slate-100 shadow-sm hover:shadow-md hover:scale-105 hover:z-10 ${isDimmed ? dimmedClass : 'opacity-100'}`}
                            `}
                            style={{ minHeight: minHeight }}
                        >
                            {/* Selected Background Highlight (Glow) */}
                            {isSelected && (
                                <div className={`absolute inset-0 ${theme.bg} blur-xl -z-10 rounded-[2.5rem]`} />
                            )}

                            {/* Image Container — see `photoRingClass` above
                                for what the opted-in path changes and why the
                                default path keeps main's markup. */}
                            <div className={`
                                relative z-10 mb-3 rounded-full p-1 transition-all duration-500
                                ${isSelected ? `bg-white p-1.5 shadow-inner` : 'bg-transparent'}
                                ${compact ? 'w-16 h-16' : 'w-20 h-20'}
                            `}>
                                <div
                                    data-testid={`crop-photo-ring-${crop.id}`}
                                    className={`
                                    relative w-full h-full rounded-full flex items-center justify-center overflow-hidden transition-colors duration-500
                                    ${photoRingClass}
                                 `}>
                                    <CropSymbol name={crop.iconName} size={compact ? 'md' : 'xl'} />
                                </div>
                            </div>

                            {/* Text Container */}
                            <div className="flex flex-col items-center gap-1 w-full relative z-10">
                                <span className={`font-black ${fontSize} leading-tight text-center transition-colors duration-300 ${isSelected ? theme.text : 'text-slate-700'}`}>
                                    {crop.name}
                                </span>

                                {!compact && (
                                    <span
                                        data-testid={`crop-count-pill-${crop.id}`}
                                        className={`
                                        text-[11px] font-black uppercase tracking-widest transition-colors duration-300
                                        ${isSelected ? countPillClass : 'text-slate-400'}
                                    `}>
                                        {mode === 'reflect' && selectedPlotCount === 0
                                            ? (hasMultiplePlots ? `${crop.plots.length} PLOTS` : '1 PLOT')
                                            : isSelected ? `${selectedPlotCount} SELECTED` : (hasMultiplePlots ? `${crop.plots.length} PLOTS` : '1 PLOT')}
                                    </span>
                                )}
                            </div>

                            {/* Hanging Checkmark Badge — see `tickBadgeClass`
                                above. */}
                            {isSelected && (
                                <div data-testid={`crop-tick-${crop.id}`} className={tickBadgeClass}>
                                    <CheckCircle2 size={tickIconSize} className="text-white drop-shadow-md" strokeWidth={4} />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* spec: owner-oversight-loop (Task 13, change 4; Task 14,
                change 3) — the demoted "Entire Farm" row. Same
                handler/selection state as the suppressed card above
                (`handleGlobalToggle`/`isGlobalSelected`) — this is a
                restyle of the SAME selection, not a second implementation.
                Task 14: the founder could not tell whether this row was
                selected — the only prior signal was a grey tick swapping
                for a grey chevron, same white card, same stone-200 border
                throughout. Selected is now unmistakably emerald (spec
                §P-G: emerald = selected); UNSELECTED stays full-colour and
                legible — position (demoted below the crop carousel) and
                plainness (no photo, a plain house icon) carry the
                secondary status, never a washed-out grey that reads as
                broken to this audience. */}
            {!compact && hideGlobalCard && (
                <button
                    type="button"
                    onClick={handleGlobalToggle}
                    disabled={disabled}
                    data-testid="crop-selector-entire-farm-row"
                    aria-pressed={isGlobalSelected}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                        isGlobalSelected
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-stone-200 bg-white hover:bg-stone-50'
                    }`}
                >
                    <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            isGlobalSelected ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600'
                        }`}
                    >
                        <Home size={18} strokeWidth={2.25} />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span
                            className={`block truncate text-sm font-bold ${
                                isGlobalSelected ? 'text-emerald-900' : 'text-stone-800'
                            }`}
                            style={fontStyleFor(resolveOversightString(language, 'entireFarmLabel'))}
                        >
                            {resolveOversightString(language, 'entireFarmLabel')}
                        </span>
                        <span
                            className={`block truncate text-xs ${
                                isGlobalSelected ? 'text-emerald-700/80' : 'text-stone-500'
                            }`}
                            style={fontStyleFor(resolveOversightString(language, 'entireFarmHint'))}
                        >
                            {resolveOversightString(language, 'entireFarmHint')}
                        </span>
                    </span>
                    {isGlobalSelected ? (
                        <span
                            data-testid="crop-selector-entire-farm-row-selected-tick"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600"
                        >
                            <CheckCircle2 size={16} className="text-white" strokeWidth={3} />
                        </span>
                    ) : (
                        <ChevronRight size={16} className="shrink-0 text-stone-400" />
                    )}
                </button>
            )}

            {/* --- INTEGRATED PLOT SELECTION TRAY (CLEAN BANNER STYLE) --- */}
            {/* Show if strict requirements met OR if showPlots prop is true */}
            {((!compact || showPlots) && selectedCrops.length > 0 && selectedCrops[0] !== 'FARM_GLOBAL') && (
                <div className="animate-in slide-in-from-top-4 duration-500">
                    {selectedCrops.map(cropId => {
                        const crop = crops.find(c => c.id === cropId);
                        if (!crop || crop.plots.length <= 1) return null;

                        const theme = getCropTheme(crop.color);

                        return (
                            <div key={cropId} className="relative mt-4">
                                {/* Connector (Subtle) */}
                                <div className={`mx-auto w-0.5 h-4 ${theme.bg} mb-1`} />

                                {/* Clean Banner Container */}
                                <div className={`
                                    relative overflow-hidden rounded-[2rem] p-1
                                    bg-white ring-1 ${theme.border} shadow-xl ${theme.shadow}
                                `}>
                                    <div className={`relative z-10 ${theme.slideBgSelected} rounded-[1.8rem] p-4`}>
                                        <div className="flex items-center justify-between mb-4">
                                            <span className={`text-xs font-black uppercase tracking-widest ${theme.text} opacity-60 pl-2`}>
                                                Select Plot
                                            </span>
                                            <div className={`h-px flex-1 ${theme.bg} ml-4 rounded-full`} />
                                        </div>

                                        <div className={
                                            crop.plots.length > 4
                                                ? "grid grid-cols-2 gap-3"
                                                : "flex flex-col gap-2"
                                        }>
                                            {crop.plots.map((plot, idx) => {
                                                const isPlotSelected = selectedPlots[cropId]?.includes(plot.id);

                                                return (
                                                    <button
                                                        key={plot.id}
                                                        data-testid="plot-tray-button"
                                                        onClick={() => handlePlotToggle(crop.id, plot.id)}
                                                        disabled={disabled}
                                                        className={`
                                                            group relative flex items-center justify-between p-4 rounded-2xl transition-all duration-300 border-2
                                                            ${isPlotSelected
                                                                ? `bg-slate-800 border-slate-800 text-white shadow-xl scale-[1.02] z-10`
                                                                : `bg-white border-slate-100 hover:${theme.border} text-slate-600 hover:shadow-md`}
                                                        `}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`
                                                                flex items-center justify-center w-8 h-8 rounded-full font-black text-xs transition-colors
                                                                ${isPlotSelected ? 'bg-white text-slate-900' : `${theme.iconBg} ${theme.iconText}`}
                                                            `}>
                                                                {idx + 1}
                                                            </div>
                                                            <div className="flex flex-col items-start">
                                                                <span className={`font-bold text-sm tracking-wide ${isPlotSelected ? 'text-white' : 'text-slate-700'}`}>
                                                                    {plot.name}
                                                                </span>
                                                                {isPlotSelected && (
                                                                    <span className="text-[10px] uppercase font-bold text-emerald-400">
                                                                        Ready to Log
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {isPlotSelected && (
                                                            <div className={`bg-emerald-500 rounded-full p-1.5 shadow-lg animate-in zoom-in duration-300`}>
                                                                <CheckCircle2 size={18} className="text-white" strokeWidth={4} />
                                                            </div>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};


export default CropSelector;

