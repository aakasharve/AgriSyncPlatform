/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CropPlotStepper — crop, then plot(s), then the footer (the mic). PLR-D5.
 *
 * The one-question-at-a-time layout of `CropSelector` (`layout="stepper"`), same
 * selection contract as the carousel, so a caller swaps layouts with one prop:
 *   - Step 1 asks ONE thing: which crop. Each answer is a big PHOTO tile. "संपूर्ण शेत"
 *     is a quiet row for work not tied to a plot. A `lead` slot sits above (Sathi).
 *   - Step 2 asks which PLOT(S). The chosen crop(s) stay on screen as photo tiles; the
 *     other crops are small photo circles ("add") one tap away, so a farmer who worked
 *     two crops that sit side by side taps the second crop here and then ticks only the
 *     plots he actually worked — across crops. "सर्व" shortcuts select everything.
 *   - the moment at least one plot (or the whole farm) is chosen, `footer` renders.
 *
 * Back is always one step and always a big labelled button: it clears the choice and
 * returns to the crop question. A crop with a single plot has that plot chosen for him
 * (see `cropSelection.ts`). No Marathi is invented here: every string is an existing
 * oversight string, or arrives through `labels` from the caller (new words are PROPOSED
 * by the caller until the founder approves them).
 */
import React, { useState } from 'react';
import { Check, Plus, Sprout } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { ENTIRE_FARM_FOCUS, ENTIRE_FARM_IMAGE, cropImageFocus, cropImageUrl } from './cropImage';
import CropCard from './CropCard';
import FlowBackButton from './FlowBackButton';
import {
    EMPTY_SELECTION, allCropsSelected, allPlotsSelected, isGlobal, isReady, pendingCrops,
    plotsOf, selectAllPlots, selectEverything, toggleCrop, toggleGlobal, togglePlot, type Selection,
} from './cropSelection';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface StepperCrop { id: string; name: string; iconName: string; plots: readonly { id: string; name: string }[] }
export type StepperStep = 'crop' | 'plot';
export interface StepperLabels {
    /** Select every crop and every plot. Hidden when absent. */
    allCrops?: string;
    /** Select every plot of the chosen crops. Hidden when absent. */
    allPlots?: string;
    /** Written on the chosen crop's card ("the crop you chose"). Hidden when absent. */
    selectedCrop?: string;
    /** Written under the "+" that adds another crop. Hidden when absent. */
    addCrop?: string;
    /** Plain words on the "entire farm" picture: when to choose it and that its cost is counted. Falls back to the approved hint. */
    entireFarmHelp?: string;
    /** The one short line under "entire farm" on its card. Falls back to the approved hint. */
    entireFarmShort?: string;
}
export interface StepperExtras {
    /** Controlled step (optional): lets a caller return to the plot step after the mic. */
    step?: StepperStep;
    onStepChange?: (step: StepperStep) => void;
    /**
     * Shown at the top of BOTH steps (Sathi asking the question). A function gets the step,
     * the names of the chosen crops (plot step) and whether "entire farm" was chosen.
     */
    lead?: React.ReactNode | ((ctx: { step: StepperStep; cropNames: string[]; global: boolean }) => React.ReactNode);
    /** Shown once a plot (or the whole farm) is chosen. `dense` = the step is crowded: render it smaller. */
    footer?: React.ReactNode | ((ctx: { dense: boolean }) => React.ReactNode);
    labels?: StepperLabels;
}
export interface CropPlotStepperProps extends StepperExtras {
    crops: readonly StepperCrop[];
    selectedCrops: readonly string[];
    selectedPlots: Record<string, string[]>;
    onSelectionChange: (crops: string[], plots: Record<string, string[]>) => void;
    disabled?: boolean;
}

/** A round crop photo (emoji-free fallback: a sprout), sized in px. */
const RoundCrop: React.FC<{ iconName: string; name: string; px: number }> = ({ iconName, name, px }) => {
    const src = cropImageUrl(iconName);
    return src
        ? <img src={src} alt={name} width={px} height={px} style={{ width: px, height: px }} className="select-none rounded-full object-cover" draggable={false} />
        : <span className="grid place-items-center rounded-full bg-emerald-100 text-emerald-700" style={{ width: px, height: px }}><Sprout size={Math.round(px * 0.6)} /></span>;
};

export const CropPlotStepper: React.FC<CropPlotStepperProps> = ({
    crops, selectedCrops, selectedPlots, onSelectionChange, disabled, step: stepProp, onStepChange, lead, footer, labels,
}) => {
    const language = useOptionalLanguage()?.language ?? 'en';
    const sel: Selection = { crops: [...selectedCrops], plots: selectedPlots };
    const global = isGlobal(sel);
    const [innerStep, setInnerStep] = useState<StepperStep>(sel.crops.length > 0 ? 'plot' : 'crop');
    const [adding, setAdding] = useState(false);
    const step: StepperStep = (stepProp ?? innerStep) === 'plot' && sel.crops.length > 0 ? 'plot' : 'crop';
    const go = (s: StepperStep) => { setInnerStep(s); onStepChange?.(s); };
    const emit = (n: Selection) => { if (!disabled) onSelectionChange(n.crops, n.plots); };

    const entireFarm = resolveOversightString(language, 'entireFarmLabel');
    const entireFarmHint = resolveOversightString(language, 'entireFarmHint');
    const renderFooter = (dense: boolean) => (typeof footer === 'function' ? footer({ dense }) : footer);
    const renderLead = (cropNames: string[]) => (typeof lead === 'function' ? lead({ step, cropNames, global }) : lead);

    if (step === 'crop') {
        // Crops + the entire farm, as one grid of equal cards: one column on a phone, two where there is room.
        // With two columns an odd last card (the farm) spans both, so the grid never has a blank hole.
        const lastWide = (crops.length + 1) % 2 === 1;
        return (
            <div className="px-3 pb-3 pt-2" style={{ fontFamily: SANS }} data-testid="flow-step-crop" data-crop-count={crops.length}>
                {renderLead([])}
                <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2" data-testid="flow-crop-grid">
                    {crops.map((c, i) => (
                        <CropCard key={c.id} testId={`flow-crop-${c.id}`} name={c.name} sub={c.plots.map(p => p.name).join(' · ')}
                            imageSrc={cropImageUrl(c.iconName)} focus={cropImageFocus(c.iconName)} disabled={disabled} delay={i * 80} lazy={i >= 2}
                            onClick={() => { emit(sel.crops.includes(c.id) ? sel : toggleCrop(sel, c)); go('plot'); }} />
                    ))}
                    {/* The whole-farm card keeps its meaning short here; the full sentence is on the next screen. */}
                    <CropCard testId="flow-crop-whole-farm" name={entireFarm} sub={labels?.entireFarmShort ?? entireFarmHint}
                        imageSrc={ENTIRE_FARM_IMAGE} focus={ENTIRE_FARM_FOCUS} disabled={disabled} wide={lastWide} delay={crops.length * 80} lazy
                        onClick={() => { emit(toggleGlobal(EMPTY_SELECTION)); go('plot'); }} />
                </div>
            </div>
        );
    }

    const chosen = crops.filter(c => sel.crops.includes(c.id));
    const others = crops.filter(c => !sel.crops.includes(c.id));
    const pending = pendingCrops(sel);
    const shown = chosen.flatMap(c => c.plots.map(p => ({ crop: c, plot: p })));
    const multiCrop = chosen.length > 1;
    const dense = multiCrop || shown.length > 3;
    const cols = multiCrop ? 'grid-cols-3 max-[339px]:grid-cols-2' : shown.length === 1 ? 'grid-cols-1' : shown.length === 3 || shown.length > 4 ? 'grid-cols-3' : 'grid-cols-2';
    // "all plots" only makes sense once more than one crop is chosen (he adds another with "+"); with one crop he just taps its plots (founder 2026-10-24)
    const showAllPlots = !!labels?.allPlots && multiCrop && shown.length > 1 && !allPlotsSelected(sel, crops);
    const showAllCrops = !!labels?.allCrops && crops.length > 1 && !allCropsSelected(sel, crops);
    const nameSize = chosen.length === 1 ? 'text-[24px]' : chosen.length === 2 ? 'text-[16px]' : 'text-[14px]';
    const goBack = () => { emit(EMPTY_SELECTION); go('crop'); };

    return (
        <div className="px-3 pb-3 pt-2" style={{ fontFamily: SANS }} data-testid="flow-step-plot" data-ready={isReady(sel) ? 'yes' : 'no'}>
            {global ? (
                <>
                <div className="flex items-center gap-2" data-testid="flow-strip">
                    <FlowBackButton stacked onClick={goBack} />
                    <div className="relative h-[76px] [@media(max-height:720px)]:h-[64px] min-w-0 flex-1 overflow-hidden rounded-2xl bg-stone-200 shadow-lg ring-[3px] ring-emerald-300" data-testid="flow-crop-chip">
                        <img src={ENTIRE_FARM_IMAGE} alt="" className="absolute inset-0 h-full w-full select-none object-cover" draggable={false} />
                        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-emerald-900/85 via-emerald-900/55 to-transparent" />
                        <span className="absolute inset-y-0 left-0 flex flex-col justify-center px-3 text-white">
                            <Check size={18} strokeWidth={4} className="text-white" />
                            <span className="block truncate text-[22px] font-extrabold leading-tight drop-shadow" style={{ fontFamily: SANS }}>{entireFarm}</span>
                        </span>
                    </div>
                </div>
                <div className="mt-3.5">{renderLead([])}</div>
                </>
            ) : (
                <>
                    {/* Back (big, labelled) + the chosen crops as photos; the others are one small tap away. */}
                    <div className="relative flex items-center gap-2" data-testid="flow-strip">
                        <FlowBackButton stacked onClick={goBack} />
                        {chosen.map(c => (
                            <button key={c.id} type="button" disabled={disabled} aria-pressed="true" data-testid={`flow-sel-${c.id}`}
                                onClick={() => { const n = toggleCrop(sel, c); emit(n); if (n.crops.length === 0) go('crop'); }}
                                className={`relative flex h-[76px] [@media(max-height:720px)]:h-[64px] min-w-0 flex-1 rounded-2xl bg-gradient-to-br from-emerald-700 to-emerald-900 text-left text-white shadow-lg ring-[3px] active:scale-95 ${multiCrop ? 'flex-col justify-between px-2 py-1.5' : 'items-center gap-2.5 px-2.5'} ${pending.includes(c.id) ? 'ring-amber-300' : 'ring-emerald-300'}`}>
                                {multiCrop ? (
                                    <>
                                        {/* Narrow cards: photo and tick on top, the whole name below. */}
                                        <span className="flex items-center justify-between">
                                            <span className="rounded-full ring-2 ring-white"><RoundCrop iconName={c.iconName} name={c.name} px={28} /></span>
                                            <Check size={16} strokeWidth={4} className="shrink-0 text-white" />
                                        </span>
                                        <span className={`block truncate font-extrabold leading-tight ${nameSize}`} style={{ fontFamily: SANS }}>{c.name}</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="shrink-0 rounded-full ring-[3px] ring-white"><RoundCrop iconName={c.iconName} name={c.name} px={46} /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1 text-[12px] font-bold text-white">
                                                <Check size={15} strokeWidth={4} className="shrink-0" />
                                                {labels?.selectedCrop && <span className="truncate max-[339px]:hidden">{labels.selectedCrop}</span>}
                                            </span>
                                            <span className={`block truncate font-extrabold leading-tight ${nameSize}`} style={{ fontFamily: SANS }}>{c.name}</span>
                                        </span>
                                    </>
                                )}
                            </button>
                        ))}
                        {/* One "+" for another crop; the crops themselves open in a tray over the screen, so the chosen crop keeps the width. */}
                        {others.length > 0 && (
                            <button type="button" disabled={disabled} data-testid="flow-add-open" aria-expanded={adding} aria-label={labels?.addCrop}
                                onClick={() => setAdding(v => !v)}
                                className={`ml-1 flex h-[76px] [@media(max-height:720px)]:h-[64px] w-[70px] max-[339px]:w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-emerald-800 active:scale-95 ${adding ? 'border-emerald-600 bg-emerald-100' : 'border-emerald-500 bg-emerald-50'}`}>
                                <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-600 text-white shadow"><Plus size={26} strokeWidth={3.5} /></span>
                                {labels?.addCrop && <span className="w-full text-center text-[12px] font-extrabold leading-none">{labels.addCrop}</span>}
                            </button>
                        )}
                        {adding && others.length > 0 && (
                            <>
                                <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setAdding(false)} />
                                <div className="absolute right-0 top-full z-30 mt-2 flex max-w-full flex-wrap justify-end gap-3 rounded-2xl border border-stone-200 bg-white p-3 shadow-2xl" data-testid="flow-add-tray">
                                    {others.map(c => (
                                        <button key={c.id} type="button" disabled={disabled} data-testid={`flow-add-${c.id}`} aria-label={c.name}
                                            onClick={() => { emit(toggleCrop(sel, c)); setAdding(false); }}
                                            className="flex w-[72px] flex-col items-center gap-1 active:scale-95">
                                            <span className="relative">
                                                <RoundCrop iconName={c.iconName} name={c.name} px={56} />
                                                <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-white"><Plus size={16} strokeWidth={3.5} /></span>
                                            </span>
                                            <span className="w-full truncate text-center text-[13px] font-extrabold text-stone-800">{c.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="mt-3.5">{renderLead(chosen.map(c => c.name))}</div>

                    <div className={`grid gap-2 ${cols}`}>
                        {shown.map(({ crop, plot }) => {
                            const on = plotsOf(sel, crop.id).includes(plot.id);
                            return (
                                <button key={plot.id} type="button" disabled={disabled} aria-pressed={on} data-testid={`flow-plot-${plot.id}`}
                                    onClick={() => emit(togglePlot(sel, crop.id, plot.id))}
                                    className={`relative inline-flex ${multiCrop ? 'min-h-[50px] [@media(max-height:720px)]:min-h-[44px] gap-1.5 px-1.5 text-[15px]' : 'min-h-[54px] [@media(max-height:720px)]:min-h-[46px] gap-2.5 px-3 text-[17px]'} min-w-0 items-center rounded-2xl border-2 font-extrabold transition active:scale-95 ${on ? 'z-10 border-emerald-800 bg-gradient-to-br from-emerald-700 to-emerald-800 text-white shadow-lg shadow-emerald-700/40 ring-2 ring-emerald-300' : 'border-dashed border-stone-300 bg-stone-100 text-stone-600'}`}>
                                    {/* Several crops: a small crop photo on the corner says which crop it is. */}
                                    {multiCrop && <span className={`absolute -left-1.5 -top-1.5 rounded-full ring-2 ring-white ${on ? '' : 'opacity-60 grayscale'}`}><RoundCrop iconName={crop.iconName} name={crop.name} px={22} /></span>}
                                    {/* Chosen or not, said without words: an empty ring, or a solid disc with a tick (grey + dashed = not chosen, green + ringed = chosen). */}
                                    <span className={`grid shrink-0 place-items-center rounded-full ${multiCrop ? 'h-5 w-5' : 'h-7 w-7'} ${on ? 'bg-white text-emerald-700 shadow' : 'border-2 border-stone-400 bg-white'}`}>
                                        {on && <Check size={multiCrop ? 14 : 20} strokeWidth={4} />}
                                    </span>
                                    <span className="min-w-0 truncate">{plot.name}</span>
                                </button>
                            );
                        })}
                        {showAllCrops && (
                            <button type="button" disabled={disabled} data-testid="flow-add-all" onClick={() => emit(selectEverything(crops))}
                                className={`inline-flex ${multiCrop ? 'min-h-[48px] [@media(max-height:720px)]:min-h-[42px] text-[14px]' : 'min-h-[52px] [@media(max-height:720px)]:min-h-[44px] text-[16px]'} min-w-0 items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50 px-2 font-extrabold text-emerald-800 active:scale-95`}>
                                <Check size={18} strokeWidth={3} /><span className="truncate">{labels?.allCrops}</span>
                            </button>
                        )}
                        {showAllPlots && (
                            <button type="button" disabled={disabled} data-testid="flow-plots-all" onClick={() => emit(selectAllPlots(sel, crops))}
                                className={`inline-flex ${multiCrop ? 'min-h-[48px] [@media(max-height:720px)]:min-h-[42px] text-[14px]' : 'min-h-[52px] [@media(max-height:720px)]:min-h-[44px] text-[16px]'} min-w-0 items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50 px-2 font-extrabold text-emerald-800 active:scale-95`}>
                                <Check size={18} strokeWidth={3} /><span className="truncate">{labels?.allPlots}</span>
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* The mic belongs to the page, below the choices: it never floats or sticks over other elements (founder 2026-10-24). */}
            {isReady(sel) && (
                <div data-testid="flow-mic-slot" className="mt-3">
                    {renderFooter(dense)}
                </div>
            )}
            {/* Crowded choices cannot fit above the bottom nav; let the step scroll clear of it. */}
            {shown.length > 4 && <div className="h-24" aria-hidden="true" />}
        </div>
    );
};

export default CropPlotStepper;
