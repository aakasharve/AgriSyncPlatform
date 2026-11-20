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
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { useCropPicture } from './cropImage';
import { SELECTOR_WORDS, allCropsColumns, allCropsLine, allCropsPhotoSlots, moreCropsText } from './plotSelectorRules';

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

/**
 * "२ प्लॉट", or "१ पैकी २ प्लॉट" once a count is chosen; "प्लॉट नाही" for a crop with none. Marathi mode writes the digits in Devanagari
 * (lane UI-9a, founder D-123b), in the screen's own font (the number font has no Devanagari digits); English keeps the number font and 0-9.
 */
export const PlotCount: React.FC<{ total: number; picked?: number; language: Language }> = ({ total, picked, language }) => {
    const w = PICKER_WORDS[language === 'en' ? 'en' : 'mr'];
    if (total === 0) return <>{w.noPlots}</>;
    if (language === 'en') {
        return picked === undefined
            ? <><Num>{total}</Num> {total === 1 ? 'plot' : 'plots'}</>
            : <><Num>{picked}</Num> of <Num>{total}</Num> {total === 1 ? 'plot' : 'plots'}</>;
    }
    return picked === undefined
        ? <>{digitsFor(total, language)} {w.plot}</>
        : <>{digitsFor(picked, language)} पैकी {digitsFor(total, language)} {w.plot}</>;
};

/** The crop's real picture (a rounded square, founder 2026-11-20: never a circle), or a plain leaf. Matched by the crop master id, then name, then icon (`cropImage.ts`). */
export const PickerCropPhoto: React.FC<{ crop: Pick<PickerCrop, 'name' | 'iconName' | 'masterId'>; px: number; className?: string }> = ({ crop, px, className = '' }) => {
    const { src, onError } = useCropPicture({ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }, 480);
    return src
        ? <img src={src} alt="" width={px} height={px} style={{ width: px, height: px }} className={`shrink-0 select-none rounded-xl object-cover shadow-sm ${className}`} draggable={false} loading="lazy" onError={onError} />
        : <span style={{ width: px, height: px }} className={`grid shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 ${className}`} aria-hidden="true"><Sprout size={Math.round(px * 0.5)} /></span>;
};

/**
 * The crop's picture as wide as the card it sits in (founder 2026-11-20, option R): edge to edge, the card's own rounded top corners
 * shape it, so no circle cuts the picture. The 960 px picture (it is shown large); the same fallbacks as `PickerCropPhoto`.
 */
export const CropPhotoFill: React.FC<{ crop: Pick<PickerCrop, 'name' | 'iconName' | 'masterId'>; heightPx?: number }> = ({ crop, heightPx = 176 }) => {
    const { src, onError } = useCropPicture({ name: crop.name, iconName: crop.iconName, masterId: crop.masterId }, 960);
    return src
        ? <img src={src} alt="" style={{ height: heightPx }} className="block w-full select-none object-cover" draggable={false} loading="lazy" onError={onError} />
        : <span style={{ height: heightPx }} className="grid w-full place-items-center bg-emerald-100 text-emerald-700" aria-hidden="true"><Sprout size={48} /></span>;
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
    /**
     * `'photo'` (founder 2026-11-20, option R): the photo goes edge to edge at the top of the card (pass a `CropPhotoFill`), under it a caption on
     * a soft tint of the crop's colour with a thin strip of the colour on top; the tick sits on the caption line, never on the picture.
     * Default `'round'`: the look before.
     */
    look?: 'round' | 'photo';
}

/** A crop (or the whole farm) as a photo tile. Chosen = green border, tick; the strip across the top is the crop's own colour. */
export const CropTile: React.FC<CropTileProps> = ({ testId, name, on, onClick, disabled, photo, color, count, wide = false, className = '', look = 'round' }) => look === 'photo' ? (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on} data-look="photo"
        className={`relative flex w-full flex-col items-stretch overflow-hidden rounded-3xl border-2 text-left transition active:scale-[0.98] disabled:opacity-60 ${on ? 'border-emerald-600 shadow-[0_8px_20px_-10px_rgba(4,120,87,0.6)]' : 'border-stone-200'} bg-white ${className}`}>
        {photo}
        <span className="relative block w-full px-3.5 pb-3 pt-3.5">
            <span aria-hidden="true" data-part="tint" className={`absolute inset-0 opacity-[0.14] ${cropColorOf(color)}`} />
            <span aria-hidden="true" data-part="accent" className={`absolute inset-x-0 top-0 h-[5px] ${cropColorOf(color)}`} />
            <span className="relative block pr-10">
                <span className="line-clamp-1 block break-words text-[20px] font-extrabold leading-tight text-stone-900">{name}</span>
                {count !== undefined && count !== null && <span className="mt-1 inline-block rounded-full bg-white/85 px-2.5 py-0.5 text-[13px] font-extrabold leading-snug text-stone-700">{count}</span>}
            </span>
        </span>
        {on && <span className="absolute bottom-3.5 right-3.5 grid h-7 w-7 place-items-center rounded-full bg-emerald-600 text-white" data-part="tick"><Check size={16} strokeWidth={3} aria-hidden="true" /></span>}
    </button>
) : (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on}
        className={`relative flex overflow-hidden rounded-3xl border-2 transition active:scale-[0.97] disabled:opacity-60 ${wide ? 'w-full items-center gap-2.5 px-3 py-2.5 text-left' : 'flex-col items-center px-2 pb-2.5 pt-4 text-center'} ${on ? 'border-emerald-600 bg-emerald-50 shadow-[0_8px_20px_-10px_rgba(4,120,87,0.6)]' : 'border-stone-200 bg-white'} ${className}`}>
        {color && <span aria-hidden="true" data-part="accent" className={`absolute ${wide ? 'inset-y-0 left-0 w-1.5' : 'inset-x-0 top-0 h-1.5'} ${color}`} />}
        {photo}
        <span className={`${wide ? 'min-w-0 flex-1' : 'mt-1.5 w-full'}`}>
            <span className="line-clamp-1 block break-words text-[15.5px] font-extrabold leading-tight text-stone-900">{name}</span>
            {count !== undefined && count !== null && (wide
                ? <span className="mt-0.5 block text-[12.5px] font-semibold leading-snug text-stone-600">{count}</span>
                : <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-extrabold leading-snug ${on ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>{count}</span>)}
        </span>
        {on && <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-600 text-white ${wide ? '' : 'absolute right-1.5 top-2.5'}`} data-part="tick"><Check size={15} strokeWidth={3} aria-hidden="true" /></span>}
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

/**
 * A plot as a chip: the crop's colour dot, its name, a tick when chosen. THE chosen look (lane UI-9a, founder 2026-11-20): dark green
 * fill, white letters, a white tick - a shape, so it still reads in sunlight; never the crop's own colour. Not chosen: white with a grey border.
 */
export const PlotChip: React.FC<PlotChipProps> = ({ testId, name, on, onClick, disabled, color, lead, mark, size = 'md' }) => (
    <button type="button" disabled={disabled} onClick={onClick} data-testid={testId} aria-pressed={on}
        className={`relative inline-flex max-w-full items-center gap-1.5 rounded-full px-3.5 font-extrabold transition active:scale-95 disabled:opacity-60 ${size === 'lg' ? 'min-h-[52px] text-[16px]' : 'min-h-[44px] text-[14.5px]'} ${on ? 'bg-emerald-800 text-white ring-2 ring-emerald-800' : 'bg-white text-stone-700 ring-1 ring-stone-400'}`}>
        <span aria-hidden="true" data-part="dot" className={`h-3 w-3 shrink-0 rounded-full ${cropColorOf(color)} ${on ? 'ring-2 ring-white' : ''}`} />
        {lead}
        <span className="min-w-0 truncate">{name}</span>
        {on && <Check size={15} strokeWidth={3} className="shrink-0 text-white" aria-hidden="true" data-part="tick" />}
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

/**
 * The all-crops card (lane UI-9a, founder pick C, 2026-11-20): ONE wide card above the crop cards with a small photo of EVERY crop, each
 * with its own colour strip, its name and its plot count. Every photo is its own button and picks that crop - the same tap as the crop's
 * card below. With every crop on the card has the green border and a tick; with one crop chosen it loses both and says "सगळी बघा", one
 * tap back to the whole farm, written where he is looking. More than 8 crops: 7 photos and a "+N पिकं" tile (info, not a button).
 */
export const AllCropsCard: React.FC<{
    crops: readonly PickerCrop[];
    chosen: 'all' | string;
    onPickCrop: (key: 'all' | string) => void;
    testIds: Pick<PickerTestIds, 'crop'>;
    language: Language;
}> = ({ crops, chosen, onPickCrop, testIds, language }) => {
    const words = PICKER_WORDS[language === 'en' ? 'en' : 'mr'];
    const sel = SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'];
    const on = chosen === 'all';
    const { shown, more } = allCropsPhotoSlots(crops.length);
    const cols = allCropsColumns(shown, more > 0);
    const px = cols >= 4 ? 64 : cols === 3 ? 84 : 96;
    const id = testIds.crop('all');
    const plots = crops.reduce((n, c) => n + c.plots.length, 0);
    return (
        <div data-testid={`${id}-card`} data-on={on ? 'yes' : 'no'}
            className={`rounded-3xl border-2 bg-white p-2.5 ${on ? 'border-emerald-700 shadow-[0_8px_20px_-12px_rgba(4,120,87,0.7)]' : 'border-stone-200'}`}>
            <button type="button" data-testid={id} aria-pressed={on} onClick={() => onPickCrop('all')}
                className="flex min-h-[44px] w-full items-center gap-2 text-left active:scale-[0.99]">
                <span className="min-w-0 flex-1 text-[19px] font-extrabold leading-tight text-stone-900">{words.allCrops}</span>
                <span className="shrink-0 text-[13px] font-bold text-stone-600" data-testid={`${id}-line`}>{allCropsLine(crops.length, plots, language)}</span>
                {on
                    ? <span data-part="tick" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-700 text-white"><Check size={16} strokeWidth={3} aria-hidden="true" /></span>
                    : <span data-part="see-all" className="inline-flex min-h-[40px] shrink-0 items-center rounded-xl border-2 border-stone-300 bg-white px-3 text-[13.5px] font-extrabold text-stone-800">{sel.seeAll}</span>}
            </button>
            <div className="mt-1.5 grid gap-2" data-testid={`${id}-photos`} data-cols={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {crops.slice(0, shown).map(c => {
                    const own = chosen === c.id;
                    return (
                        <button key={c.id} type="button" data-testid={`${id}-photo-${c.id}`} aria-pressed={own} onClick={() => onPickCrop(c.id)}
                            className={`flex min-w-0 flex-col items-center rounded-2xl border-2 px-1 pb-1.5 pt-1.5 text-center active:scale-95 ${own ? 'border-emerald-700 bg-emerald-50' : 'border-transparent bg-stone-50'}`}>
                            <span className="relative">
                                <PickerCropPhoto crop={c} px={px} />
                                {own && <span data-part="tick" className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-emerald-700 text-white"><Check size={14} strokeWidth={3} aria-hidden="true" /></span>}
                            </span>
                            <span aria-hidden="true" data-part="accent" className={`mt-1 block h-[5px] rounded-full ${cropColorOf(c.color)}`} style={{ width: px }} />
                            <span className="mt-1 line-clamp-1 w-full break-words text-[13.5px] font-extrabold leading-tight text-stone-900">{cropNameIn(c.name, language, c.masterId)}</span>
                            <span className="block text-[11.5px] font-bold leading-tight text-stone-600"><PlotCount total={c.plots.length} language={language} /></span>
                        </button>
                    );
                })}
                {more > 0 && (
                    <span data-testid={`${id}-more`} className="grid place-items-center rounded-2xl border-2 border-dashed border-stone-300 px-1 text-center text-[14px] font-extrabold text-stone-600">{moreCropsText(more, language)}</span>
                )}
            </div>
            <p className="m-0 mt-1.5 text-[12.5px] font-bold text-stone-500">{language === 'en' ? 'Tap a photo: only that crop is shown' : 'फोटो दाबा: फक्त ते पीक दिसेल'}</p>
        </div>
    );
};

/** Crop tiles first, then the plots of the chosen crop (or of every crop), each plot with its crop's colour. */
export const CropPlotPicker: React.FC<CropPlotPickerProps> = ({
    crops, chosen, pickedPlotIds, onPickCrop, onTogglePlot, allCrops = false, choiceOnly = false, hidePlots = false, cropQuestion, plotQuestion, testIds, language: languageProp,
}) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    const of = (key: 'all' | string) => crops.filter(c => key === 'all' || c.id === key);
    const picked = (cropId: string) => of(cropId).reduce((n, c) => n + c.plots.filter(p => pickedPlotIds.includes(p.id)).length, 0);
    const allTile = allCrops && crops.length > 1;
    // The all-crops card (UI-9a) sits ABOVE the crop cards, so the cards themselves are the crops only.
    // With no all-crops card to stand for "everything" (one crop, or a page that does not offer it), a page that is on `all` has every crop on.
    const isOn = (c: PickerCrop) => chosen === c.id || (chosen === 'all' && !allTile);
    const plotsShown = of(chosen).flatMap(c => c.plots.map(p => ({ p, c })));
    const showTiles = !choiceOnly || crops.length > 1;
    const showPlots = !hidePlots && (choiceOnly ? plotsShown.length > 1 : plotsShown.length > 0);
    const question = (text: string | undefined) => (text ? <p className="m-0 mb-1 px-1 text-[13.5px] font-extrabold text-stone-600">{text}</p> : null);

    return (
        <div data-testid={testIds.root} className="space-y-2.5">
            {showTiles && (
                <div data-testid={testIds.cropRow}>
                    {question(cropQuestion)}
                    {allTile && <div className="mb-2.5"><AllCropsCard crops={crops} chosen={chosen} onPickCrop={onPickCrop} testIds={testIds} language={language} /></div>}
                    <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1">
                        {crops.map(c => {
                            const on = isOn(c);
                            return (
                                <CropTile key={c.id} testId={testIds.crop(c.id)} name={cropNameIn(c.name, language, c.masterId)} on={on} onClick={() => onPickCrop(c.id)}
                                    color={cropColorOf(c.color)}
                                    className="min-w-[108px] max-w-[160px] flex-1 shrink-0 snap-start"
                                    photo={<PickerCropPhoto crop={c} px={56} />}
                                    count={<PlotCount total={c.plots.length} picked={on ? picked(c.id) : undefined} language={language} />} />
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
