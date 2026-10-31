/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 = 2A and D-59 = 3A) — "तपासा आणि जतन करा":
 * the SAME result-screen look for a parse that was not saved by itself, saying what is unclear. Replaces the old
 * hand-filled form (MULCHING / PRUNING) for every such parse. Presentational; the hosts own the data and the save.
 *
 *   - his words, always ("तुम्ही सांगितलं: …") — nothing he said is dropped (P9, P10);
 *   - nothing understood: one big "पुन्हा सांगा" (THE one mic, MIC-1) and, right under it, "बोलता येत नसेल तर इथे लिहा"
 *     (the same understanding as speech); there is nothing to save, so no save button (P5);
 *   - Sathi thinks it was another plot: the place chip opens the canonical crop → plot steps with his guess marked
 *     (rule CTX-1); nothing saves until he has chosen;
 *   - the phone could not write it: "पुन्हा जतन करा";
 *   - the place chip and the DAY chip (rule TAP-1: the same calendar) on every case that can be saved.
 */
import React from 'react';
import { AlertTriangle, CalendarDays, ChevronDown, HelpCircle, MapPin, Mic, Pencil } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { AddedRow, BlockerRow, TypedTag } from '../voiceResult/DayParts';
import type { BlockerEntry, PartEntry } from '../voiceResult/resultModel';
import { checkSaveWords } from './checkSaveWords';
import type { CheckCase } from './checkSaveModel';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface CheckSaveScreenProps {
    kind: CheckCase;
    transcript: string;
    typed: boolean;
    /** "रात्री 7:40", when the recording has a time (an offline recording from आवाज नोंदी). */
    spokenAt?: string;
    understood: { entries: readonly PartEntry[]; blockers: readonly BlockerEntry[] };
    /** Where it will be saved; '' = not chosen yet. */
    placeLabel: string;
    /** `otherPlot`: what he had chosen, and Sathi's guess. */
    chosenLabel?: string;
    guessLabel?: string;
    /** The day chip's words ("आज", "शुक्र, 30 ऑक्टो"), and the line when it is not today. */
    dayLabel: string;
    dayNote?: string;
    saving: boolean;
    saveFailed: boolean;
    /** The recording is on the phone (not typed): the "kept" line is true. */
    kept: boolean;
    onSayAgain: () => void;
    onType: () => void;
    onPickPlace: () => void;
    onPickDay: () => void;
    onSave: () => void;
}

export const CheckSaveScreen: React.FC<CheckSaveScreenProps> = (p) => {
    const language = useOptionalLanguage()?.language;
    const w = checkSaveWords(language);
    const unclear = p.kind === 'unclear';
    const needsPlace = p.kind === 'otherPlot' && !p.placeLabel;
    return (
        <div className="space-y-3 pb-6 pt-1" style={{ fontFamily: SANS }} data-testid="check-save" data-kind={p.kind}>
            <h2 className="m-0 text-[20px] font-extrabold text-stone-900" data-testid="check-title">{unclear ? w.titleUnclear : w.titleCheck}</h2>

            {p.kind === 'notWritten' && (
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-[15px] font-bold leading-snug text-red-900" data-testid="check-not-written">
                    <p className="m-0 flex items-center gap-1.5 font-extrabold"><AlertTriangle size={18} aria-hidden="true" />{w.notWrittenTitle}</p>
                    <p className="m-0 mt-0.5">{w.notWrittenBody}</p>
                </div>
            )}
            {p.kind === 'otherPlot' && (
                <div className="rounded-2xl border-2 border-sky-300 bg-sky-50 p-3 text-[15px] font-bold leading-snug text-sky-950" data-testid="check-other-plot">
                    <p className="m-0 flex items-center gap-1.5 font-extrabold"><MapPin size={18} aria-hidden="true" />{w.otherPlotTitle}</p>
                    {p.chosenLabel && p.guessLabel && <p className="m-0 mt-0.5">{w.otherPlotBody(p.chosenLabel, p.guessLabel)}</p>}
                </div>
            )}

            {!unclear && (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={p.onPickPlace} data-testid="check-place"
                        className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-[15px] font-extrabold ${needsPlace ? 'border-sky-500 bg-sky-600 text-white' : 'border-stone-300 bg-white text-stone-800'}`}>
                        <MapPin size={16} aria-hidden="true" />{p.placeLabel || w.choosePlace}<ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={p.onPickDay} data-testid="check-day"
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-stone-300 bg-white px-3 text-[15px] font-extrabold text-stone-800">
                        <CalendarDays size={16} aria-hidden="true" />{p.dayLabel}<ChevronDown size={16} aria-hidden="true" />
                    </button>
                    {p.spokenAt && <span className="text-[13px] font-bold text-stone-600" data-testid="check-spoken-at">{w.spokenAt(p.spokenAt)}</span>}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white p-3 text-[16px] font-bold text-stone-900" data-testid="check-said">
                <span className="text-[13px] text-stone-600">{w.youSaid}:</span>
                {p.typed && <TypedTag testId="check-said-typed" />}
                <span>“{p.transcript}”</span>
            </div>

            {unclear ? (
                <>
                    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-[15px] font-bold leading-snug text-amber-950" data-testid="check-unclear">
                        <p className="m-0 flex items-center gap-1.5 font-extrabold"><HelpCircle size={18} aria-hidden="true" />{w.unclearTitle}</p>
                        <p className="m-0 mt-0.5">{w.unclearBody}</p>
                    </div>
                    <div className="pt-1 text-center">
                        <button type="button" onClick={p.onSayAgain} aria-label={w.sayAgain} data-testid="check-say-again"
                            className="mx-auto grid h-[104px] w-[104px] place-items-center rounded-full bg-emerald-700 text-white shadow-[0_8px_24px_rgba(4,120,87,0.35)] active:scale-95">
                            <Mic size={46} strokeWidth={2.25} aria-hidden="true" />
                        </button>
                        <p className="m-0 mt-1.5 text-[17px] font-extrabold text-stone-900">{w.sayAgain}</p>
                    </div>
                </>
            ) : (
                (p.understood.entries.length > 0 || p.understood.blockers.length > 0) && (
                    <div data-testid="check-understood">
                        <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">{w.understood}</div>
                        <div className="space-y-1.5">
                            {p.understood.entries.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}
                            {p.understood.blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                        </div>
                    </div>
                )
            )}

            <button type="button" onClick={p.onType} data-testid="check-type"
                className="mx-auto flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-[15px] font-bold text-stone-700">
                <Pencil size={17} aria-hidden="true" />{w.typeInstead}
            </button>

            {p.dayNote && <p className="m-0 px-1 text-[13.5px] font-bold text-stone-700" data-testid="check-day-note">{p.dayNote}</p>}

            {!unclear && (
                <>
                    {!p.placeLabel && <p className="m-0 px-1 text-[14px] font-bold text-sky-800" data-testid="check-place-first">{w.choosePlaceFirst}</p>}
                    <button type="button" onClick={p.onSave} disabled={p.saving || !p.placeLabel} data-testid="check-save-button"
                        className="min-h-[56px] w-full rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:bg-stone-300">
                        {p.saving ? w.saving : p.kind === 'notWritten' ? w.saveAgain : w.save}
                    </button>
                    {p.saveFailed && <p className="m-0 text-[14px] font-bold text-red-700" data-testid="check-save-failed">{w.saveFailed}</p>}
                </>
            )}

            {unclear && p.kept && <p className="m-0 text-center text-[13.5px] font-semibold text-stone-600" data-testid="check-kept">{w.keptNote}</p>}
        </div>
    );
};

export default CheckSaveScreen;
