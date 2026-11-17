/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-7; founder D-150 "one crop selector -> plot selector, same on
 * every page, colour coded", picture O2 "crop cards with photos first, then that crop's plots")
 *
 * THE one look of "which crop, which plots": a crop is a PHOTO TILE (its picture, its name in his language, "N पैकी N प्लॉट", a
 * tick when chosen, a strip in the crop's own colour), and a plot is a CHIP carrying the same colour as a dot. Every page that asks
 * for a crop or a plot draws these two pieces, so the crop wears the same colour everywhere (the plot cards on the आढावा page
 * already do).
 *
 * Two layers, both pure views — they hold no selection of their own and change no rule:
 *   - `CropTile`, `PlotChip`, `PickerCropPhoto`, `PlotCount`: the pieces. `CropPlotStepper` (the log flow's one-question-at-a-time
 *     layout, also under PlanForm, the task-done sheet and the place picker) lays them out its own way, one question at a time.
 *   - `CropPlotPicker`: tiles then chips on one screen, for a page whose model is "one crop (or all of them), then plots" — the
 *     आढावा page (`FarmStatus`) and the schedule tab. The page keeps its own selection model and its own pure rules
 *     (`reflectSelection.ts`, the schedule page's `pick`) and adapts at this edge: it says which tile is on and which plots are
 *     picked, and hears `onPickCrop` / `onTogglePlot`.
 *
 * Words: Marathi first, English twin; every string here is PROPOSED (same wording the आढावा page already used).
 */
import React from 'react';
import { Check, Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { cropNameIn } from '../../../shared/names/namesIn';
import { useCropPicture } from './cropImage';

const NUM = "'DM Sans', sans-serif";

/** A crop as the picker needs it. A `CropProfile` fits as it is. `name` is the STORED name; the picker shows it in his language. */
export interface PickerCrop {
    id: string;
    name: string;
    iconName: string;
    masterId?: string;
    /** The crop's own colour, a Tailwind `bg-…` class (`profile/helpers/cropPalette.ts`). */
    color?: string;
    plots: readonly { id: string; name: string }[];
}

/** PROPOSED (Marathi / English) */
export const PICKER_WORDS = {
    mr: { allCrops: 'सर्व पिकं', noPlots: 'प्लॉट नाही', plot: 'प्लॉट' },
    en: { allCrops: 'All crops', noPlots: 'No plots', plot: 'plots' },
} as const;

/** The crop's colour class, or a quiet grey when the crop has none (never a missing colour that reads as "no crop"). */
export const cropColorOf = (color: string | undefined): string => (color && color.startsWith('bg-') ? color : 'bg-stone-400');

const Num: React.FC<{ children: React.ReactNode }> = ({ children }) => <span style={{ fontFamily: NUM }}>{children}</span>;

/** "2 प्लॉट", or "1 पैकी 2 प्लॉट" once a count is chosen; "प्लॉट नाही" for a crop with none. */
export const PlotCount: React.FC<{ total: number; picked?: number; language: Language }> = ({ total, picked, language }) => {
    const w = PICKER_WORDS[language === 'en' ? 'en' : 'mr'];
    if (total === 0) return <>{w.noPlots}</>;
    if (language === 'en') {
        return picked === undefined
            ? <><Num>{total}</Num> {total === 1 ? 'plot' : 'plots'}</>
            : <><Num>{picked}</Num> of <Num>{total}</Num> {total === 1 ? 'plot' : 'plots'}</>;
    }
    return picked === undefined
        ? <><Num>{total}</Num> {w.plot}</>
        : <><Num>{picked}</Num> पैकी <Num>{total}</Num> {w.plot}</>;
};

/** The crop's real picture (round), or a plain leaf. Matched by the crop master id, then name, then icon (`cropImage.ts`). */
export const PickerCropPhoto: React.FC<{ crop: Pick<PickerCrop, 'name' | 'iconName' | 'masterId'>; px: number; className?: string }> = ({ crop, px, className = '' }) => {
    const { src, onError } = useCropPicture({ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }, 480);
    return src
        ? <img src={src} alt="" width={px} height={px} style={{ width: px, height: px }} className={`shrink-0 select-none rounded-full object-cover shadow-sm ${className}`} draggable={false} loading="lazy" onError={onError} />
        : <span style={{ width: px, height: px }} className={`grid shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 ${className}`} aria-hidden="true"><Sprout size={Math.round(px * 0.5)} /></span>;
};

export interface CropTileProps {
    testId: string;
    name: string;
    on: boolean;
    onClick: () => void;
    disabled?: boolean;
    /** The picture (a `PickerCropPhoto`, or the whole-farm picture). */
    photo: React.ReactNode;
    /** The crop's colour class; the tile's strip. Omit for the whole farm. */
    color?: string;
    /** The small line under the name (a `PlotCount`, or one short sentence). */
    count?: React.ReactNode;
    /** A wide row (picture left, words right) instead of a tile. */
    wide?: boolean;
    /** Extra classes on the button (a ring that says "needs a plot", a width). */
    className?: string;
}

/** A crop (or the whole farm) as a photo tile. Chosen = green border, tick; the strip across the top is the crop's own colour. */
export const CropTile: React.FC<CropTileProps> = ({ testId, name, on, onClick, disabled, photo, color, count, wide = false, className = '' }) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on}
        className={`relative flex overflow-hidden rounded-3xl border-2 transition active:scale-[0.97] disabled:opacity-60 ${wide ? 'w-full items-center gap-3 px-4 py-2.5 text-left' : 'flex-col items-center px-2 pb-2.5 pt-4 text-center'} ${on ? 'border-emerald-600 bg-emerald-50 shadow-[0_8px_20px_-10px_rgba(4,120,87,0.6)]' : 'border-stone-200 bg-white'} ${className}`}>
        {color && <span aria-hidden="true" data-part="accent" className={`absolute ${wide ? 'inset-y-0 left-0 w-1.5' : 'inset-x-0 top-0 h-1.5'} ${color}`} />}
        {photo}
        <span className={`${wide ? 'min-w-0 flex-1' : 'mt-1.5 w-full'}`}>
            <span className="line-clamp-1 block break-words text-[15.5px] font-extrabold leading-tight text-stone-900">{name}</span>
            {count !== undefined && count !== null && (wide
                ? <span className="mt-0.5 block text-[12.5px] font-semibold leading-snug text-stone-600">{count}</span>
                : <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-extrabold leading-snug ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{count}</span>)}
        </span>
        {on && <span className="absolute right-1.5 top-2.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white" data-part="tick"><Check size={15} strokeWidth={3} aria-hidden="true" /></span>}
    </button>
);

export interface PlotChipProps {
    testId: string;
    name: string;
    on: boolean;
    onClick: () => void;
    disabled?: boolean;
    /** The crop's colour class: the dot. */
    color?: string;
    /** Something small before the name (a crop photo when several crops are on screen). */
    lead?: React.ReactNode;
    /** Something small after the name (a short tag such as "आत्ता इथे"). */
    mark?: React.ReactNode;
    /** 'lg' is the one-question screens' size (still one line, still a thumb). */
    size?: 'md' | 'lg';
}

/** A plot as a chip: the crop's colour dot, its name, a tick when chosen. Chosen = green ring and tick; not chosen = plain grey ring. */
export const PlotChip: React.FC<PlotChipProps> = ({ testId, name, on, onClick, disabled, color, lead, mark, size = 'md' }) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on}
        className={`relative inline-flex max-w-full items-center gap-1.5 rounded-full px-3.5 font-extrabold transition active:scale-95 disabled:opacity-60 ${size === 'lg' ? 'min-h-[52px] text-[16px]' : 'min-h-[44px] text-[14.5px]'} ${on ? 'bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500' : 'bg-white text-stone-500 ring-1 ring-stone-300'}`}>
        <span aria-hidden="true" data-part="dot" className={`h-3 w-3 shrink-0 rounded-full ${cropColorOf(color)}`} />
        {lead}
        <span className="min-w-0 truncate">{name}</span>
        {on && <Check size={15} strokeWidth={3} className="shrink-0 text-emerald-600" aria-hidden="true" data-part="tick" />}
        {mark}
    </button>
);

export interface PickerTestIds {
    root?: string;
    /** The row of crop tiles (with its question line). */
    cropRow?: string;
    /** The row of plot chips (with its question line). */
    plotRow?: string;
    /** A crop tile: `key` is a crop id, or `all`. */
    crop: (key: 'all' | string) => string;
    plot: (plotId: string) => string;
}

export interface CropPlotPickerProps {
    crops: readonly PickerCrop[];
    /** The tile that is on: `all` (every crop) or one crop id. */
    chosen: 'all' | string;
    /** The plots that are picked (flat). Drives "N पैकी N प्लॉट" and the chips' ticks. */
    pickedPlotIds: readonly string[];
    onPickCrop: (key: 'all' | string) => void;
    onTogglePlot: (cropId: string, plotId: string) => void;
    /** Draw the "सर्व पिकं" tile first (only when there is more than one crop). */
    allCrops?: boolean;
    /** Draw a row only when it holds a real choice: tiles for more than one crop, chips for more than one plot. */
    choiceOnly?: boolean;
    /** Draw the crop tiles only (a screen that asks for the crop and nothing under it). */
    hidePlots?: boolean;
    /** Small question lines above the rows ("पीक", "प्लॉट"). */
    cropQuestion?: string;
    plotQuestion?: string;
    testIds: PickerTestIds;
    /** Language override (tests, previews); default the app's, Marathi outside a provider. */
    language?: Language;
}

type Tile = { key: 'all' | string; crop?: PickerCrop };

/** Crop tiles first, then the plots of the chosen crop (or of every crop), each plot with its crop's colour. */
export const CropPlotPicker: React.FC<CropPlotPickerProps> = ({
    crops, chosen, pickedPlotIds, onPickCrop, onTogglePlot, allCrops = false, choiceOnly = false, hidePlots = false, cropQuestion, plotQuestion, testIds, language: languageProp,
}) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    const words = PICKER_WORDS[language === 'en' ? 'en' : 'mr'];
    const of = (key: 'all' | string) => crops.filter(c => key === 'all' || c.id === key);
    const total = (key: 'all' | string) => of(key).reduce((n, c) => n + c.plots.length, 0);
    const picked = (key: 'all' | string) => of(key).reduce((n, c) => n + c.plots.filter(p => pickedPlotIds.includes(p.id)).length, 0);
    const allTile = allCrops && crops.length > 1;
    const tiles: Tile[] = [...(allTile ? [{ key: 'all' as const }] : []), ...crops.map(c => ({ key: c.id, crop: c }))];
    // With no "all" tile to stand for "everything" (one crop, or a page that does not offer it), a page that is on `all` has every crop on.
    const isOn = (t: Tile) => chosen === t.key || (chosen === 'all' && !allTile && t.crop !== undefined);
    const plotsShown = of(chosen).flatMap(c => c.plots.map(p => ({ p, c })));
    const showTiles = !choiceOnly || tiles.length > 1;
    const showPlots = !hidePlots && (choiceOnly ? plotsShown.length > 1 : plotsShown.length > 0);
    const question = (text: string | undefined) => (text ? <p className="m-0 mb-1 px-1 text-[13.5px] font-extrabold text-stone-600">{text}</p> : null);

    return (
        <div data-testid={testIds.root} className="space-y-2.5">
            {showTiles && (
                <div data-testid={testIds.cropRow}>
                    {question(cropQuestion)}
                    <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
                        {tiles.map(t => {
                            const on = isOn(t);
                            const name = t.crop ? cropNameIn(t.crop.name, language, t.crop.masterId) : words.allCrops;
                            return (
                                <CropTile key={t.key} testId={testIds.crop(t.key)} name={name} on={on} onClick={() => onPickCrop(t.key)}
                                    color={t.crop ? cropColorOf(t.crop.color) : undefined}
                                    className="min-w-[108px] max-w-[160px] flex-1 shrink-0 snap-start"
                                    photo={t.crop
                                        ? <PickerCropPhoto crop={t.crop} px={56} />
                                        : <span className="flex h-14 w-14 items-center -space-x-4">{crops.slice(0, 3).map(c => <PickerCropPhoto key={c.id} crop={c} px={40} className="ring-2 ring-white" />)}</span>}
                                    count={<PlotCount total={total(t.key)} picked={on ? picked(t.key) : undefined} language={language} />} />
                            );
                        })}
                    </div>
                </div>
            )}
            {showPlots && (
                <div data-testid={testIds.plotRow}>
                    {question(plotQuestion)}
                    <div className="flex flex-wrap gap-2">
                        {plotsShown.map(({ p, c }) => (
                            <PlotChip key={p.id} testId={testIds.plot(p.id)} name={p.name} on={pickedPlotIds.includes(p.id)} color={c.color} onClick={() => onTogglePlot(c.id, p.id)} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CropPlotPicker;
