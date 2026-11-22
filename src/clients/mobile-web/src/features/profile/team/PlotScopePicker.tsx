/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §6; orchestrator call 8) — the owner's ONE row on a person's team card,
 * "प्लॉट: सर्व प्लॉट ›", and the sheet it opens: three choices — सर्व प्लॉट / निवडलेले प्लॉट (the farm's plots, now the
 * shared plot card once per crop - see below) / स्वतःचं काम. The same row sits on a joining request, where it starts from the preset's default (कामगार →
 * स्वतःचं काम). Server truth only: the row shows what the server last said; "ठेवा" sends the whole choice and the card
 * adopts the row the server returns — nothing moves before that. Chosen plots need at least one (the server refuses
 * none, so the button stays off until one is ticked, P5). The founder's home design language: the placeUi pieces, big
 * tap targets, Marathi first.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 6; founder-approved 2026-11-21) — "निवडलेले प्लॉट" draws the
 * SHARED plot card once per crop (it was one flat list of tick rows, in letter order, with no crop): the crop's photo once, its plots as chips
 * (1 to 6) or the number grid in natural order (G2 before G10, 7 or more) with the quick button "सगळे निवडा N", chosen = dark green with a
 * tick, and ONE count line for the whole farm at the end ("१८ पैकी ५ निवडले"). A plot no crop of this phone's crop list holds (`useFarmPlots`)
 * is drawn after the crops, under "इतर प्लॉट", never guessed into a crop. "ठेवा" stays off until at least one plot is chosen, and `onSave` still
 * receives exactly the chosen plot ids.
 */
import React, { useState } from 'react';
import { ChevronRight, MapPin } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { Tap } from '../../../shared/components/ui/placeUi';
import { PlotCount } from '../../context/components/CropPlotPicker';
import { PickedCountLine, PlotGroupHeader, PlotSelector, cropWordsOf } from '../../context/components/PlotSelector';
import type { PlotScopeChoice, PlotScopeName } from '../data/membershipAdminClient';
import { plotScopeCopy, plotScopeSummary } from './plotScopeCopy';
import type { FarmPlot, FarmPlotCrop } from './useFarmPlots';

const CHOICES: readonly PlotScopeName[] = ['AllPlots', 'ChosenPlots', 'OwnWork'];

/**
 * lane MU-4 fix pass 1 (M7, P5) — only the choices that change what he gets, in the sheet's own order. A कामगार's label
 * already narrows him to his own work, so "सर्व प्लॉट" would read exactly as "स्वतःचं काम": the server leaves it out, and
 * the card says why (`labelFixesOwnWork`). An unknown name is dropped; nothing usable = all three (an older server).
 */
export function offeredChoices(choices: readonly string[] | undefined): readonly PlotScopeName[] {
    const offered = CHOICES.filter(c => choices?.includes(c));
    return offered.length > 0 ? offered : CHOICES;
}

export interface PlotScopePickerProps {
    /** Whose card (test ids). */
    memberId: string;
    /** What the server last said (or, on a request, the preset's default). */
    value: PlotScopeChoice;
    farmPlots: readonly FarmPlot[];
    busy: boolean;
    onSave: (choice: PlotScopeChoice) => void;
    /** The row's value in place of the choice's own word (a joining request: what each preset starts from). */
    summary?: string;
    /** lane MU-4 fix pass 1 (M7) — the server's choices that change something for him (absent = all three). */
    choices?: readonly PlotScopeName[];
}

/** One crop's plots as the owner's card draws them (`crop` absent = the plots no crop of this phone holds). */
export interface PlotGroup { key: string; crop?: FarmPlotCrop; plots: FarmPlot[] }

/** The plots grouped by crop, in the order `useFarmPlots` lists them (crop by crop, plots with no known crop last). */
export function groupPlotsByCrop(farmPlots: readonly FarmPlot[]): PlotGroup[] {
    const groups: PlotGroup[] = [];
    const byKey = new Map<string, PlotGroup>();
    for (const plot of farmPlots) {
        const key = plot.crop?.id ?? '';
        let group = byKey.get(key);
        if (!group) {
            group = { key, crop: plot.crop, plots: [] };
            byKey.set(key, group);
            groups.push(group);
        }
        group.plots.push(plot);
    }
    return groups;
}

export const PlotScopePicker: React.FC<PlotScopePickerProps> = ({ memberId, value, farmPlots, busy, onSave, summary: shown, choices }) => {
    const language = useOptionalLanguage()?.language;
    const copy = plotScopeCopy(language);
    const lang: Language = language === 'en' ? 'en' : 'mr';
    const [open, setOpen] = useState(false);
    const [scope, setScope] = useState<PlotScopeName>(value.plotScope);
    const [ticked, setTicked] = useState<Set<string>>(new Set(value.plotIds ?? []));
    const names = new Map(farmPlots.map(p => [p.id, p.name]));
    const summary = shown ?? plotScopeSummary(copy, value.plotScope, value.plotIds, names);
    // What is drawn as chosen is what counts: a plot the server named that this phone does not hold is not a plot he can see chosen here.
    const pickedCount = farmPlots.filter(p => ticked.has(p.id)).length;
    const groups = groupPlotsByCrop(farmPlots);
    const canSave = !busy && (scope !== 'ChosenPlots' || pickedCount > 0);
    const offered = offeredChoices(choices);
    const fixedByLabel = !offered.includes('AllPlots');

    const openSheet = () => {
        setScope(value.plotScope);
        setTicked(new Set(value.plotIds ?? []));
        setOpen(o => !o);
    };
    /** The selector hands back the whole new chosen set of ONE crop's plots; the other crops' choices stay as they were. */
    const setCropPlots = (group: PlotGroup, chosenInGroup: readonly string[]) => setTicked(current => {
        const next = new Set(current);
        for (const plot of group.plots) next.delete(plot.id);
        for (const id of chosenInGroup) next.add(id);
        return next;
    });
    const save = () => {
        onSave(scope === 'ChosenPlots' ? { plotScope: scope, plotIds: farmPlots.map(p => p.id).filter(id => ticked.has(id)) } : { plotScope: scope });
        setOpen(false);
    };

    return (
        <div className="space-y-2" data-testid={`plot-scope-${memberId}`}>
            <Tap onClick={openSheet} aria-expanded={open} disabled={busy} data-testid={`plot-scope-row-${memberId}`}
                className="flex min-h-[48px] w-full items-center gap-2 rounded-2xl bg-white px-3 text-left ring-1 ring-stone-300 disabled:opacity-60">
                <MapPin size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">
                    {copy.rowLabel}: <span data-testid={`plot-scope-summary-${memberId}`}>{summary}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-stone-500" aria-hidden="true" />
            </Tap>
            {fixedByLabel && (
                <p className="m-0 px-1 text-[12.5px] font-semibold leading-snug text-stone-600" data-testid={`plot-scope-rule-${memberId}`}>
                    {copy.labelFixesOwnWork}
                </p>
            )}

            {open && (
                <div role="dialog" aria-label={copy.sheetTitle} className="space-y-2 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200"
                    data-testid={`plot-scope-sheet-${memberId}`}>
                    <p className="m-0 text-[15px] font-extrabold text-stone-800">{copy.sheetTitle}</p>
                    {offered.map(choice => (
                        <div key={choice} className="space-y-1.5">
                            <Tap onClick={() => setScope(choice)} aria-pressed={scope === choice} data-testid={`plot-scope-choice-${choice}-${memberId}`}
                                className={`w-full min-h-[52px] rounded-2xl border-2 px-3 py-2 text-left ${scope === choice ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'}`}>
                                <span className="block text-[16px] font-extrabold text-stone-900">{copy.choice[choice]}</span>
                                <span className="block text-[12.5px] font-semibold leading-snug text-stone-600">{copy.choiceHint[choice]}</span>
                            </Tap>
                            {choice === 'ChosenPlots' && scope === 'ChosenPlots' && (
                                <div className="space-y-3 pt-1" data-testid={`plot-scope-plots-${memberId}`}>
                                    {farmPlots.length === 0 && <p className="m-0 text-[13px] font-bold text-stone-600">{copy.noPlots}</p>}
                                    {groups.map(group => {
                                        const key = group.key || 'none';
                                        return (
                                            <section key={key} className="space-y-2" data-testid={`plot-scope-crop-${key}-${memberId}`}>
                                                {group.crop
                                                    ? <PlotGroupHeader crop={group.crop} language={lang} testId={`plot-scope-header-${key}-${memberId}`} sub={<PlotCount total={group.plots.length} language={lang} />} />
                                                    : groups.length > 1 && <p className="m-0 text-[18px] font-extrabold leading-tight text-stone-900" data-testid={`plot-scope-header-${key}-${memberId}`}>{copy.otherPlots}</p>}
                                                <PlotSelector
                                                    plots={group.plots.map(plot => ({ id: plot.id, name: plot.name || '—' }))}
                                                    chosen={group.plots.filter(plot => ticked.has(plot.id)).map(plot => plot.id)}
                                                    onChange={next => setCropPlots(group, next)}
                                                    allToggle="toggle" color={group.crop?.color} cropNames={group.crop ? cropWordsOf(group.crop) : []}
                                                    underHeader={!!group.crop} language={lang}
                                                    testIds={{ plot: id => `plot-scope-plot-${id}-${memberId}`, all: `plot-scope-all-${key}-${memberId}`, grid: `plot-scope-grid-${key}-${memberId}` }} />
                                            </section>
                                        );
                                    })}
                                    {farmPlots.length > 0 && <PickedCountLine total={farmPlots.length} picked={pickedCount} testId={`plot-scope-count-${memberId}`} language={lang} />}
                                    {pickedCount === 0 && farmPlots.length > 0 && (
                                        <p className="m-0 text-[14px] font-bold text-amber-800" data-testid={`plot-scope-pick-one-${memberId}`}>{copy.pickOne}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Tap onClick={save} disabled={!canSave} data-testid={`plot-scope-save-${memberId}`}
                            className="min-h-[48px] rounded-full bg-[#1448E6] px-5 text-[15px] font-extrabold text-white disabled:opacity-50">
                            {copy.save}
                        </Tap>
                        <Tap onClick={() => setOpen(false)} data-testid={`plot-scope-cancel-${memberId}`}
                            className="min-h-[48px] rounded-full bg-white px-5 text-[15px] font-extrabold text-stone-700 ring-1 ring-stone-300">
                            {copy.cancel}
                        </Tap>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlotScopePicker;
