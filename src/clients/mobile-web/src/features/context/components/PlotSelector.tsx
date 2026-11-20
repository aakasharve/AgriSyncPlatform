/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder picks 2026-11-20: Log A "number grid with quick buttons",
 * overview C "number grid in place"; the UX designer's improved pictures)
 *
 * THE plot selector: the plots of ONE crop, drawn by `plotSelectorRules` - chips for 1 to 6 plots, a number grid plus quick buttons from 7,
 * a search box from 25. Used by the log's plot question (and so by planning, the task-done sheet and the place picker) and by the आढावा
 * picker; the next lane (schedule library, Team, Setup) draws the same piece.
 *
 * A pure view: it holds no selection (only the search text it is typing). It is told the crop's plots and the chosen ones, and says what
 * the farmer did through `onChange` (the whole new chosen set of THESE plots) or - when a page has its own tap rule - `onTapPlot`.
 *
 * One "chosen" look everywhere: dark green fill, white letters, a white tick (a shape, so it reads in sunlight); never the crop's own
 * colour as the chosen signal (grapes are green). Not chosen: white with a grey border. The crop's colour is a small dot on a chip and a thin
 * strip under the photo in a group header; a number box carries none (fix round, 2026-11-20).
 *
 * Honesty: the quick buttons come in from the host (`quickButtons`), built from facts the phone holds (`buildQuickButtons`); this view
 * invents none and draws none whose count is zero. `groups` is an extension point that nothing feeds yet (a later lane): each named group
 * is drawn as one more quick button.
 *
 * Words: Marathi first, English twin; every string here is PROPOSED.
 */
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { cropNameIn } from '../../../shared/names/namesIn';
import { digitsFor } from '../../../shared/utils/marathiDigits';
import { PickerCropPhoto, PlotChip, PlotCount, cropColorOf, type PickerCrop } from './CropPlotPicker';
import {
    QUICK_WORDS, SELECTOR_WORDS, afterAllToggle, allChosen, hasPlotSearch, pickedCountText, plotMatchesQuery, plotPickMode,
    naturalOrder, plotNumbers, plotPosition, plotShortName, photoOnceFor, sameSet, toggleId, type PlotPickMode,
} from './plotSelectorRules';

const NUM = "'DM Sans', sans-serif";

export interface PlotSelectorQuick { id: string; label: string; plotIds: readonly string[] }
/** A later lane (GRP-1) feeds named groups; today nothing does. Each one is drawn as one more quick button. */
export interface PlotSelectorGroup { name: string; plotIds: readonly string[] }
export type AllToggleMode = 'toggle' | 'select' | 'none';

export interface PlotSelectorTestIds {
    plot: (plotId: string) => string;
    /** The "सगळे निवडा / सगळे निवडले" button. */
    all?: string;
    /** A quick button (`yesterday`, `todayLeft`, `toldToday`, or `group:<name>`). */
    quick?: (id: string) => string;
    search?: string;
    grid?: string;
}

// ── the small pieces ─────────────────────────────────────────────────────────────────────────────────

const QuickButtonView: React.FC<{ testId?: string; label: string; on: boolean; onClick: () => void; disabled?: boolean; inert?: boolean }> = ({ testId, label, on, onClick, disabled, inert }) => (
    <button type="button" disabled={disabled} data-testid={testId} aria-pressed={on} aria-disabled={inert || undefined} onClick={inert ? undefined : onClick}
        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border-2 px-3 text-[14px] font-extrabold transition active:scale-95 disabled:opacity-60 ${on ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-stone-400 bg-white text-stone-800'}`}>
        {on && <Check size={15} strokeWidth={3} className="shrink-0 text-white" aria-hidden="true" data-part="tick" />}
        <span>{label}</span>
    </button>
);

/**
 * The quick buttons: ONE toggle that chooses all or clears all ("सगळे निवडा" / "सगळे निवडले"), then the true buttons the host built, then
 * named groups. `allToggle="select"` is for a page that is never empty: when all are chosen the button reads "सगळे निवडले" and does nothing.
 * Draws nothing when there is nothing to draw.
 */
export const PlotQuickRow: React.FC<{
    plotIds: readonly string[];
    chosen: readonly string[];
    onChange: (next: string[]) => void;
    allToggle?: AllToggleMode;
    buttons?: readonly PlotSelectorQuick[];
    groups?: readonly PlotSelectorGroup[];
    testIds?: Pick<PlotSelectorTestIds, 'all' | 'quick'>;
    language?: Language;
    disabled?: boolean;
}> = ({ plotIds, chosen, onChange, allToggle = 'toggle', buttons = [], groups = [], testIds, language: languageProp, disabled }) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    const w = QUICK_WORDS[language === 'en' ? 'en' : 'mr'];
    const within = chosen.filter(id => plotIds.includes(id));
    const everything = allChosen(plotIds, within);
    const all = allToggle !== 'none' && plotIds.length > 1;
    const groupButtons: PlotSelectorQuick[] = groups
        .map(g => ({ id: `group:${g.name}`, label: `${g.name} ${digitsFor(g.plotIds.length, language)}`, plotIds: g.plotIds.filter(id => plotIds.includes(id)) }))
        .filter(g => g.plotIds.length > 0);
    const all$ = [...buttons.filter(b => b.plotIds.length > 0), ...groupButtons];
    if (!all && all$.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-2" data-testid="plot-quick-row">
            {all && (
                <QuickButtonView testId={testIds?.all} on={everything} disabled={disabled} inert={allToggle === 'select' && everything}
                    label={everything ? w.allDone : `${w.all} ${digitsFor(plotIds.length, language)}`}
                    onClick={() => onChange(afterAllToggle(plotIds, within, allToggle === 'toggle'))} />
            )}
            {all$.map(b => (
                <QuickButtonView key={b.id} testId={testIds?.quick?.(b.id)} label={b.label} disabled={disabled}
                    on={sameSet(within, b.plotIds.filter(id => plotIds.includes(id)))}
                    onClick={() => onChange(plotIds.filter(id => b.plotIds.includes(id)))} />
            ))}
        </div>
    );
};

/** "१५ पैकी ४ निवडले": one sentence, always the same words, right above the confirm button. */
export const PickedCountLine: React.FC<{ total: number; picked: number; testId?: string; language?: Language; className?: string }> = ({ total, picked, testId, language: languageProp, className = '' }) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    return <p className={`m-0 text-[14.5px] font-extrabold text-emerald-800 ${className}`} data-testid={testId} aria-live="polite">{pickedCountText(total, picked, language)}</p>;
};

/** The crop's photo ONCE, with its name and (when asked) a small line; the plots under it carry only its colour and name. */
export const PlotGroupHeader: React.FC<{
    crop: Pick<PickerCrop, 'name' | 'iconName' | 'masterId' | 'color'>;
    sub?: React.ReactNode;
    right?: React.ReactNode;
    testId?: string;
    language?: Language;
}> = ({ crop, sub, right, testId, language: languageProp }) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    // Founder 2026-11-20 (fix round, header A): the crop's own colour is a thin strip under the photo it belongs to - not a bar floating at the
    // right edge. The name is 18 px and the count line 14 px in a darker grey, so both read in sunlight.
    return (
        <div className="flex items-start gap-2.5" data-testid={testId} data-part="group-header">
            <span className="flex w-10 shrink-0 flex-col" data-part="photo-column">
                <PickerCropPhoto crop={crop} px={40} />
                <span aria-hidden="true" data-part="strip" className={`mt-1 block h-1 rounded-full ${cropColorOf(crop.color)}`} />
            </span>
            <span className="flex min-h-[40px] min-w-0 flex-1 flex-col justify-center">
                <span className="block truncate text-[18px] font-extrabold leading-tight text-stone-900">{cropNameIn(crop.name, language, crop.masterId)}</span>
                {sub !== undefined && sub !== null && <span className="block text-[14px] font-bold leading-snug text-stone-700">{sub}</span>}
            </span>
            {right}
        </div>
    );
};

/**
 * One plot as a number box (founder 2026-11-20, fix round, tile A): its place in the crop big, its own (short) name small under it. No dot - the
 * crop's colour told the farmer nothing here (every box of a crop had the same one) and it sat on the number. The tick has its own corner
 * (top 2, right 2, 14 px) and the number starts 15 px from the top, so the two never touch. 64 px tall, so a thumb always finds it.
 */
export const PlotNumberBox: React.FC<{
    testId: string;
    position: number;
    name: string;
    on: boolean;
    onClick: () => void;
    mark?: React.ReactNode;
    disabled?: boolean;
    language: Language;
}> = ({ testId, position, name, on, onClick, mark, disabled, language }) => (
    <button type="button" disabled={disabled} data-testid={testId} aria-pressed={on} onClick={onClick}
        className={`relative flex h-[64px] min-w-0 flex-col items-center rounded-[14px] border-2 px-0.5 pt-[15px] text-center transition active:scale-95 disabled:opacity-60 ${on ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-stone-400 bg-white text-stone-900'}`}>
        {on && <span data-part="tick" className="absolute right-[2px] top-[2px] grid h-[14px] w-[14px] place-items-center rounded-full bg-white text-emerald-800"><Check size={10} strokeWidth={4} aria-hidden="true" /></span>}
        <span className="text-[24px] font-black leading-[26px]" style={language === 'en' ? { fontFamily: NUM } : undefined} data-part="number">{digitsFor(position, language)}</span>
        <span className={`block max-w-full truncate text-[13px] font-extrabold leading-[15px] ${on ? 'text-white' : 'text-stone-900'}`} data-part="name">{name}</span>
        {mark}
    </button>
);

/** Every way a crop's word may start a stored plot name: as stored, and in Marathi and in English (for `cropNames`). */
export const cropWordsOf = (crop: { name: string; masterId?: string }): string[] =>
    [crop.name, cropNameIn(crop.name, 'mr', crop.masterId), cropNameIn(crop.name, 'en', crop.masterId)];

// ── the selector ─────────────────────────────────────────────────────────────────────────────────────

export interface PlotSelectorProps {
    /** The crop's plots, in the farm's own order (the list is drawn, and its boxes numbered, in natural number order). */
    plots: readonly { id: string; name: string }[];
    /** The chosen plots (of these plots). */
    chosen: readonly string[];
    /**
     * The whole new chosen set of these plots (a quick button, the toggle, or a plain tap when `onTapPlot` is not given). May be left out only by
     * a page that hears every tap through `onTapPlot` and draws its own quick row (the आढावा page).
     */
    onChange?: (next: string[]) => void;
    /** A page with its own tap rule (the आढावा page's "one tap shows only that plot") hears the tap instead of `onChange`. */
    onTapPlot?: (plotId: string) => void;
    /**
     * Each plot's number, by plot id - built from ALL the crop's plots (`plotNumbers(wholeCropPlots)`). When given, a box shows `numbers.get(id)`
     * instead of the plot's rank in the list it is handed, so a narrowed list never renumbers: G3 stays 3 among three plots of fifteen. A plot
     * the map does not hold falls back to its rank in this list. Default (no map): the rank, as before.
     */
    numbers?: ReadonlyMap<string, number>;
    /** The crop's colour class (the dot on a chip; the number boxes of the grid carry none). */
    color?: string;
    /** The crop's names, in any language the stored plot names might start with; used to say "G7" instead of "द्राक्ष G7". */
    cropNames?: readonly (string | undefined)[];
    /** The plots sit under a header that says the crop, so its word is dropped from their names. Default: from 4 plots (the photo-once rule). */
    underHeader?: boolean;
    quickButtons?: readonly PlotSelectorQuick[];
    groups?: readonly PlotSelectorGroup[];
    /** Grid mode only. `toggle` (default) chooses all and clears all; `select` never clears; `none` draws no toggle. */
    allToggle?: AllToggleMode;
    /** A small tag on a plot (Sathi's "आत्ता इथे"): marked, never chosen for him. */
    mark?: (plotId: string, mode: PlotPickMode) => React.ReactNode;
    /** Something small before a chip's name (a crop photo, for a small crop on a screen with several crops). Chips only. */
    lead?: React.ReactNode;
    chipSize?: 'md' | 'lg';
    testIds: PlotSelectorTestIds;
    language?: Language;
    disabled?: boolean;
}

export const PlotSelector: React.FC<PlotSelectorProps> = ({
    plots, chosen, onChange, onTapPlot, numbers, color, cropNames, underHeader, quickButtons, groups, allToggle = 'toggle', mark, lead, chipSize, testIds, language: languageProp, disabled,
}) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    const [query, setQuery] = useState('');
    const mode = plotPickMode(plots.length);
    const short = underHeader ?? photoOnceFor(plots.length);
    const nameOf = (name: string) => (short ? plotShortName(name, cropNames ?? []) : name);
    const change = onChange ?? (() => undefined);
    const tap = (id: string) => (onTapPlot ? onTapPlot(id) : change(toggleId(chosen, id)));
    // Natural number order (G2 before G10), and the number on a box is its place in that same order (G3 reads 3), so a name and its number agree.
    // With `numbers` (the crop's WHOLE list) the number is that place among all the crop's plots, not among the plots in view.
    const entries = naturalOrder(plots.map(p => p.name)).map((i, rank) => ({ p: plots[i], position: numbers?.get(plots[i].id) ?? plotPosition(rank) }));
    const ids = entries.map(e => e.p.id);

    if (mode === 'chips') {
        return (
            <div data-mode="chips" className="space-y-2">
                {(quickButtons?.length || groups?.length) ? (
                    <PlotQuickRow plotIds={ids} chosen={chosen} onChange={change} allToggle="none" buttons={quickButtons} groups={groups} testIds={testIds} language={language} disabled={disabled} />
                ) : null}
                <div className="flex flex-wrap gap-2" data-testid={testIds.grid}>
                    {entries.map(({ p }) => (
                        <PlotChip key={p.id} testId={testIds.plot(p.id)} name={nameOf(p.name)} on={chosen.includes(p.id)} disabled={disabled} color={color} size={chipSize} lead={lead}
                            mark={mark?.(p.id, 'chips')} onClick={() => tap(p.id)} />
                    ))}
                </div>
            </div>
        );
    }

    const sw = SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'];
    const shown = entries.filter(x => plotMatchesQuery({ name: x.p.name, position: x.position }, query));
    return (
        <div data-mode="grid" className="space-y-2">
            <PlotQuickRow plotIds={ids} chosen={chosen} onChange={change} allToggle={allToggle} buttons={quickButtons} groups={groups} testIds={testIds} language={language} disabled={disabled} />
            {hasPlotSearch(plots.length) && (
                <input type="search" value={query} onChange={e => setQuery(e.target.value)} data-testid={testIds.search} aria-label={sw.search} placeholder={sw.search}
                    className="min-h-[46px] w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-[15px] font-bold text-stone-900 placeholder:text-stone-500" />
            )}
            <div className="grid grid-cols-5 gap-2 max-[339px]:grid-cols-4" data-testid={testIds.grid}>
                {shown.map(({ p, position }) => (
                    <PlotNumberBox key={p.id} testId={testIds.plot(p.id)} position={position} name={nameOf(p.name)} on={chosen.includes(p.id)} disabled={disabled}
                        mark={mark?.(p.id, 'grid')} language={language} onClick={() => tap(p.id)} />
                ))}
            </div>
            {shown.length === 0 && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid={testIds.search ? `${testIds.search}-empty` : undefined}>{sw.noMatch}</p>}
        </div>
    );
};

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 4; founder 2026-11-21) - the plots of ONE crop as the shared
 * selector, for a page that chooses a SINGLE plot: the schedule library's step 1 and the schedule editor. Chips for 1 to 6 plots, a number grid
 * from 7 (the rules in `plotSelectorRules`); the one chosen plot is dark green with a white tick; no "select all" (one plot, not many).
 *
 * `crop.plots` is the crop's WHOLE list, so each number is the plot's place among all the crop's plots (`plotNumbers`) - handed on as `numbers`,
 * so the number stays right even if a caller later narrows the list it draws. `header` says the crop once (its photo, name and "N प्लॉट") above
 * the plots, for a screen with no crop row of its own; the plots then drop the crop word from their names (display only). With a crop row
 * above (several crops), pass no header: the row already says the crop. A pure view: it holds no selection and reports the tapped plot.
 */
export const SinglePlotSection: React.FC<{
    crop: PickerCrop;
    /** The one chosen plot, or `null` when none is chosen yet. */
    plotId: string | null;
    onPickPlot: (plotId: string) => void;
    header?: boolean;
    testIds: PlotSelectorTestIds;
    /** The test ids of the section and of its crop header (both optional). */
    sectionTestId?: string;
    headerTestId?: string;
    language?: Language;
}> = ({ crop, plotId, onPickPlot, header = false, testIds, sectionTestId, headerTestId, language: languageProp }) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    return (
        <section className="space-y-2" data-testid={sectionTestId} data-header={header ? 'yes' : 'no'}>
            {header && <PlotGroupHeader crop={crop} testId={headerTestId} language={language} sub={<PlotCount total={crop.plots.length} language={language} />} />}
            <PlotSelector plots={crop.plots} numbers={plotNumbers(crop.plots)} chosen={plotId ? [plotId] : []} onTapPlot={onPickPlot} allToggle="none"
                color={crop.color} cropNames={cropWordsOf(crop)} underHeader={header || photoOnceFor(crop.plots.length)} testIds={testIds} language={language} />
        </section>
    );
};

export default PlotSelector;
