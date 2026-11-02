/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §6; orchestrator call 8) — the owner's ONE row on a person's team card,
 * "प्लॉट: सर्व प्लॉट ›", and the sheet it opens: three choices — सर्व प्लॉट / निवडलेले प्लॉट (a tick row per plot of
 * this farm) / स्वतःचं काम. The same row sits on a joining request, where it starts from the preset's default (कामगार →
 * स्वतःचं काम). Server truth only: the row shows what the server last said; "ठेवा" sends the whole choice and the card
 * adopts the row the server returns — nothing moves before that. Chosen plots need at least one (the server refuses
 * none, so the button stays off until one is ticked, P5). The founder's home design language: the placeUi pieces, big
 * tap targets, Marathi first.
 */
import React, { useState } from 'react';
import { Check, ChevronRight, MapPin } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { Tap } from '../../../shared/components/ui/placeUi';
import type { PlotScopeChoice, PlotScopeName } from '../data/membershipAdminClient';
import { plotScopeCopy, plotScopeSummary } from './plotScopeCopy';
import type { FarmPlot } from './useFarmPlots';

const CHOICES: readonly PlotScopeName[] = ['AllPlots', 'ChosenPlots', 'OwnWork'];

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
}

export const PlotScopePicker: React.FC<PlotScopePickerProps> = ({ memberId, value, farmPlots, busy, onSave, summary: shown }) => {
    const language = useOptionalLanguage()?.language;
    const copy = plotScopeCopy(language);
    const [open, setOpen] = useState(false);
    const [scope, setScope] = useState<PlotScopeName>(value.plotScope);
    const [ticked, setTicked] = useState<Set<string>>(new Set(value.plotIds ?? []));
    const names = new Map(farmPlots.map(p => [p.id, p.name]));
    const summary = shown ?? plotScopeSummary(copy, value.plotScope, value.plotIds, names);
    const canSave = !busy && (scope !== 'ChosenPlots' || ticked.size > 0);

    const openSheet = () => {
        setScope(value.plotScope);
        setTicked(new Set(value.plotIds ?? []));
        setOpen(o => !o);
    };
    const toggle = (plotId: string) => setTicked(current => {
        const next = new Set(current);
        if (next.has(plotId)) next.delete(plotId);
        else next.add(plotId);
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

            {open && (
                <div role="dialog" aria-label={copy.sheetTitle} className="space-y-2 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200"
                    data-testid={`plot-scope-sheet-${memberId}`}>
                    <p className="m-0 text-[15px] font-extrabold text-stone-800">{copy.sheetTitle}</p>
                    {CHOICES.map(choice => (
                        <div key={choice} className="space-y-1.5">
                            <Tap onClick={() => setScope(choice)} aria-pressed={scope === choice} data-testid={`plot-scope-choice-${choice}-${memberId}`}
                                className={`w-full min-h-[52px] rounded-2xl border-2 px-3 py-2 text-left ${scope === choice ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'}`}>
                                <span className="block text-[16px] font-extrabold text-stone-900">{copy.choice[choice]}</span>
                                <span className="block text-[12.5px] font-semibold leading-snug text-stone-600">{copy.choiceHint[choice]}</span>
                            </Tap>
                            {choice === 'ChosenPlots' && scope === 'ChosenPlots' && (
                                <ul className="m-0 space-y-1.5 p-0 pl-2" data-testid={`plot-scope-plots-${memberId}`}>
                                    {farmPlots.length === 0 && <li className="list-none text-[13px] font-bold text-stone-600">{copy.noPlots}</li>}
                                    {farmPlots.map(plot => (
                                        <li key={plot.id} className="list-none">
                                            <Tap onClick={() => toggle(plot.id)} aria-pressed={ticked.has(plot.id)}
                                                data-testid={`plot-scope-plot-${plot.id}-${memberId}`}
                                                className={`flex min-h-[48px] w-full items-center gap-2 rounded-xl px-3 text-left ring-1 ${ticked.has(plot.id) ? 'bg-emerald-50 ring-emerald-500' : 'bg-white ring-stone-300'}`}>
                                                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${ticked.has(plot.id) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-400 bg-white'}`}>
                                                    {ticked.has(plot.id) && <Check size={16} aria-hidden="true" />}
                                                </span>
                                                <span className="text-[15px] font-extrabold text-stone-900 [overflow-wrap:anywhere]">{plot.name || '—'}</span>
                                            </Tap>
                                        </li>
                                    ))}
                                    {ticked.size === 0 && farmPlots.length > 0 && (
                                        <li className="list-none text-[12.5px] font-bold text-amber-800" data-testid={`plot-scope-pick-one-${memberId}`}>{copy.pickOne}</li>
                                    )}
                                </ul>
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
