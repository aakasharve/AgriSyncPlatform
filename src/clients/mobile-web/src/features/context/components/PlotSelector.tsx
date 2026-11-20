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
 * colour as the chosen signal (grapes are green). Not chosen: white with a grey border. The crop's colour is only a small dot.
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
import { PickerCropPhoto, PlotChip, cropColorOf, type PickerCrop } from './CropPlotPicker';
import {
    QUICK_WORDS, SELECTOR_WORDS, afterAllToggle, allChosen, hasPlotSearch, pickedCountText, plotMatchesQuery, plotPickMode,
    naturalOrder, plotPosition, plotShortName, photoOnceFor, sameSet, toggleId, type PlotPickMode,
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
    return (
        <div className="flex items-center gap-2.5" data-testid={testId} data-part="group-header">
            <PickerCropPhoto crop={crop} px={40} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-extrabold leading-tight text-stone-900">{cropNameIn(crop.name, language, crop.masterId)}</span>
                {sub !== undefined && sub !== null && <span className="block text-[12.5px] font-bold leading-snug text-stone-600">{sub}</span>}
            </span>
            {right}
        </div>
    );
};

/** One plot as a number box: its place in the crop big, its own (short) name small under it, the crop's colour as a dot. */
export const PlotNumberBox: React.FC<{
    testId: string;
    position: number;
    name: string;
    on: boolean;
    onClick: () => void;
    color?: string;
    mark?: React.ReactNode;
    disabled?: boolean;
    language: Language;
}> = ({ testId, position, name, on, onClick, color, mark, disabled, language }) => (
    <button type="button" disabled={disabled} data-testid={testId} aria-pressed={on} onClick={onClick}
        className={`relative flex min-h-[60px] min-w-0 flex-col items-center justify-center rounded-2xl border-2 px-0.5 py-1 text-center transition active:scale-95 disabled:opacity-60 ${on ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-stone-400 bg-white text-stone-800'}`}>
        <span aria-hidden="true" data-part="dot" className={`absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ${cropColorOf(color)} ${on ? 'ring-2 ring-white' : ''}`} />
        {on && <span data-part="tick" className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-white text-emerald-800"><Check size={11} strokeWidth={4} aria-hidden="true" /></span>}
        <span className="text-[22px] font-black leading-none" style={language === 'en' ? { fontFamily: NUM } : undefined} data-part="number">{digitsFor(position, language)}</span>
        <span className={`mt-0.5 block max-w-full truncate text-[12px] font-extrabold leading-tight ${on ? 'text-emerald-50' : 'text-stone-700'}`} data-part="name">{name}</span>
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
    /** The crop's colour class (the dot). */
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
    plots, chosen, onChange, onTapPlot, color, cropNames, underHeader, quickButtons, groups, allToggle = 'toggle', mark, lead, chipSize, testIds, language: languageProp, disabled,
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
    const entries = naturalOrder(plots.map(p => p.name)).map((i, rank) => ({ p: plots[i], position: plotPosition(rank) }));
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
                    <PlotNumberBox key={p.id} testId={testIds.plot(p.id)} position={position} name={nameOf(p.name)} on={chosen.includes(p.id)} color={color} disabled={disabled}
                        mark={mark?.(p.id, 'grid')} language={language} onClick={() => tap(p.id)} />
                ))}
            </div>
            {shown.length === 0 && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid={testIds.search ? `${testIds.search}-empty` : undefined}>{sw.noMatch}</p>}
        </div>
    );
};

export default PlotSelector;
