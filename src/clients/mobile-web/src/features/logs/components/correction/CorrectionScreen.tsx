/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1 → lane OF) — "बदला". Presentational; `core/speak/
 * CorrectionHost` owns the data and the save.
 *
 * Lane OF (founder D-61 = 5A + rule TAP-1, 2026-10-31 — "voice is always the first choice; typing and tapping are always
 * there as the fallback"; it supersedes the 2026-10-30 "फक्त बोलून बदला"). Top to bottom, as the working phones (5A):
 *   1. the big mic, "जे बदलायचं ते बोलून सांगा" — THE one mic (lane MIC-1);
 *   2. right under it, "बोलता येत नसेल तर इथे लिहा" — typed words go through the same understanding as speech;
 *   3. "किंवा दाबून बदला": the plot and the day; each part, its value tappable (kind of work; product name, amount, unit;
 *      water method and hours; worker count); "काढा" / "परत आणा"; "+ आणखी जोडा";
 *   4. before → after as before: a changed part outlined and tagged "बदललं", its old value struck through; "जतन करा".
 * At least one part always stays. Tap changes need no internet: they queue like any other change (P10) — except a worker
 * count, which says plainly that it needs the internet until its queued route exists (`correctionCapabilities`). The
 * plot and the day of a SAVED entry are shown read-only with one plain line until the server can move it (P5).
 * A record the हजेरी door saved is not changed here: बदला opens that day in the हजेरी वही instead (D-57); without हजेरी
 * access the screen says where it can be changed.
 */
import React from 'react';
import { ArrowLeft, CalendarDays, Keyboard, MapPin, Mic, Pencil, Plus, RotateCcw, Users, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { PHONE_COLUMN } from '../phoneColumn';
import { BlockerRow, TypedTag } from '../voiceResult/DayParts';
import { PartIcon } from '../voiceResult/HisWords';
import { partNameIn } from '../voiceResult/partNames';
import { partMeta, type BlockerEntry } from '../voiceResult/resultModel';
import { correctionWords } from './correctionWords';
import type { TapRow } from './tapEdit';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface CorrectionScreenProps {
    /** "रात्री 8:02", when the entry has a time. */
    timeLabel: string;
    /** "द्राक्ष · G1", or the whole farm. */
    placeLabel: string;
    /** "शनि, 31 ऑक्टो" — the entry's day. */
    dayLabel: string;
    confirmed: boolean;
    /** What he said (or typed) for it, once he has; with what it changed. */
    spoken?: { transcript: string; typed: boolean; nothing: boolean; labourNotChanged?: boolean };
    /** Every part as it would be saved, against the entry as it is (tapEdit.tapRows). */
    rows: readonly TapRow[];
    /** Stoppages his words changed. */
    blockers: { after: readonly BlockerEntry[]; gone: readonly BlockerEntry[]; changed: boolean };
    /** Something differs from the saved entry: "जतन करा" is offered. */
    changed: boolean;
    /** He tried to remove the last part. */
    keepOne: boolean;
    /** A हजेरी-door record and no हजेरी access: not changed here. */
    refused: boolean;
    saving: boolean;
    saveFailed: boolean;
    saveFailedReason?: 'labour' | 'other';
    /** No internet: speaking / typing a change does not work (it needs the understanding). */
    offline?: boolean;
    serverRefused?: boolean;
    /** The server can move a saved entry's plot / day (`correctionCapabilities`). */
    canMove: boolean;
    onSpeak: () => void;
    onType: () => void;
    onSave: () => void;
    onBack: () => void;
    onEditRow: (row: TapRow) => void;
    onToggleRow: (row: TapRow) => void;
    onAdd: () => void;
    onChangePlot?: () => void;
    onChangeDay?: () => void;
    /** Present only for someone who may open हजेरी (never a dead button, P5). */
    onOpenAttendance?: () => void;
}

const Row: React.FC<{ row: TapRow; onEdit: () => void; onToggle: () => void }> = ({ row, onEdit, onToggle }) => {
    const language = useOptionalLanguage()?.language;
    const w = correctionWords(language);
    const m = partMeta(row.part);
    const tag = row.removed ? w.removedTag : row.isNew ? w.newTag : row.was !== undefined ? w.changedTag : '';
    // `gone`: a saved part his words dropped — struck through, nothing to tap.
    const marked = !row.removed && (row.isNew || row.was !== undefined);
    const value = (
        <>
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-extrabold text-stone-600">
                {partNameIn(row.part, language)}
                {tag && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-extrabold text-white ${row.removed ? 'bg-red-600' : 'bg-emerald-700'}`} data-testid={`corr-tag-${row.id}`}>{tag}</span>}
            </span>
            <span className={`flex items-center gap-1.5 text-[18px] font-extrabold leading-tight ${row.removed ? 'text-stone-400 line-through' : 'text-stone-900'}`} data-testid={`corr-value-${row.id}`}>
                {row.text}{row.editable && !row.removed && <Pencil size={15} className="shrink-0 text-stone-500" aria-hidden="true" />}
            </span>
            {row.was !== undefined && !row.removed && <span className="block text-[13.5px] font-bold text-stone-400 line-through" data-testid={`corr-old-${row.id}`}>{w.was}: {row.was}</span>}
        </>
    );
    return (
        <div data-testid={`corr-row-${row.id}`} data-part={row.part} data-changed={marked || row.removed ? 'yes' : 'no'}
            className={`flex items-center gap-2.5 rounded-xl border-l-4 bg-white p-2.5 ${row.removed ? 'border-red-300 opacity-80' : marked ? 'border-emerald-600 ring-2 ring-emerald-500' : 'border-stone-300'}`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: m.tint }}><PartIcon part={row.part} size={24} /></span>
            {row.editable && !row.removed ? (
                <button type="button" onClick={onEdit} data-testid={`corr-edit-${row.id}`} className="min-w-0 flex-1 text-left">{value}</button>
            ) : (
                <span className="min-w-0 flex-1">{value}</span>
            )}
            {row.removable && (
                <button type="button" onClick={onToggle} data-testid={`corr-toggle-${row.id}`}
                    className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border px-3 text-[14px] font-extrabold ${row.removed ? 'border-emerald-500 text-emerald-800' : 'border-stone-300 text-stone-700'}`}>
                    {row.removed ? <RotateCcw size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}{row.removed ? w.restore : w.remove}
                </button>
            )}
        </div>
    );
};

export const CorrectionScreen: React.FC<CorrectionScreenProps> = (p) => {
    const language = useOptionalLanguage()?.language;
    const words = correctionWords(language);
    const head = [words.title, p.timeLabel, p.placeLabel].filter(Boolean).join(' · ');
    return (
        <div className="fixed inset-0 z-[70] flex justify-center bg-stone-900/30">
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={head} data-testid="corr-screen" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={p.onBack} data-testid="corr-back"
                        className="inline-flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{words.back}</span>
                    </button>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-extrabold text-stone-900" data-testid="corr-title">{head}</span>
                        <span className={`text-[12px] font-extrabold ${p.confirmed ? 'text-emerald-700' : 'text-stone-600'}`} data-testid="corr-state">{p.confirmed ? words.confirmed : words.notConfirmed}</span>
                    </span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-24 pt-3">
                    {p.serverRefused && <p className="m-0 rounded-2xl border border-red-200 bg-red-50 p-3 text-[15px] font-bold text-red-800" data-testid="corr-server-refused">{words.serverRefused}</p>}

                    {p.refused ? (
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] font-bold leading-snug text-amber-950" data-testid="corr-refused">
                            <p className="m-0 flex items-start gap-2"><Users size={20} className="mt-0.5 shrink-0" aria-hidden="true" />{words.labourDoor}</p>
                            {p.onOpenAttendance && (
                                <button type="button" onClick={p.onOpenAttendance} data-testid="corr-open-attendance"
                                    className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-amber-500 bg-white text-[16px] font-extrabold text-amber-900">{words.openAttendance}</button>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* 1. Voice first: the big mic. */}
                            <div className="pt-1 text-center">
                                {p.offline && <p className="m-0 mb-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left text-[15px] font-bold text-amber-950" data-testid="corr-offline">{words.offline}</p>}
                                <button type="button" onClick={p.onSpeak} aria-label={words.mic} data-testid="corr-mic"
                                    className="mx-auto grid h-[100px] w-[100px] place-items-center rounded-full bg-emerald-700 text-white shadow-[0_8px_24px_rgba(4,120,87,0.35)] active:scale-95">
                                    <Mic size={46} strokeWidth={2.25} aria-hidden="true" />
                                </button>
                                <p className="m-0 mt-2 text-[17px] font-extrabold text-stone-900" data-testid="corr-prompt">{words.speakPrompt}</p>
                                {!p.spoken && (
                                    <div className="mt-2 rounded-2xl border border-stone-200 bg-white p-3 text-left text-[14px] font-bold leading-relaxed text-stone-800" data-testid="corr-examples">
                                        {words.examples.map(x => <div key={x}>{x}</div>)}
                                    </div>
                                )}
                            </div>
                            {/* 2. Right under it: typing, read like speech. */}
                            <button type="button" onClick={p.onType} data-testid="corr-type"
                                className="mx-auto flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-[15px] font-bold text-stone-700">
                                <Keyboard size={18} aria-hidden="true" />{words.typeInstead}
                            </button>

                            {p.spoken && (
                                <>
                                    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white p-2.5 text-[14px] font-bold text-stone-800" data-testid="corr-said">
                                        <span className="text-stone-600">{words.youSaid}:</span>
                                        {p.spoken.typed && <TypedTag testId="corr-said-typed" />}
                                        {p.spoken.transcript && <span>“{p.spoken.transcript}”</span>}
                                    </div>
                                    {p.spoken.labourNotChanged && <p className="m-0 rounded-2xl border border-stone-300 bg-white p-3 text-[15px] font-bold text-stone-800" data-testid="corr-labour-hajeri">{words.labourInHajeri}</p>}
                                    {p.spoken.nothing && !p.spoken.labourNotChanged && <p className="m-0 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[15px] font-bold text-amber-900" data-testid="corr-nothing">{words.nothingChanged}</p>}
                                </>
                            )}

                            {/* 3. Or by tapping. */}
                            <div className="flex items-center gap-2 pt-1 text-[13px] font-extrabold text-stone-500" data-testid="corr-or-tap">
                                <span className="h-px flex-1 bg-stone-300" />{words.orTap}<span className="h-px flex-1 bg-stone-300" />
                            </div>
                            <div className="flex items-center gap-2 rounded-xl bg-white p-2.5 text-[15px] font-extrabold text-stone-800 ring-1 ring-stone-200" data-testid="corr-plot-row">
                                <MapPin size={17} className="shrink-0 text-emerald-700" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{p.placeLabel}</span>
                                {p.canMove && p.onChangePlot && <button type="button" onClick={p.onChangePlot} data-testid="corr-change-plot" className="min-h-[40px] rounded-full border border-emerald-500 px-3 text-[14px] font-extrabold text-emerald-800">{words.changePlot}</button>}
                            </div>
                            <div className="flex items-center gap-2 rounded-xl bg-white p-2.5 text-[15px] font-extrabold text-stone-800 ring-1 ring-stone-200" data-testid="corr-day-row">
                                <CalendarDays size={17} className="shrink-0 text-emerald-700" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{p.dayLabel}</span>
                                {p.canMove && p.onChangeDay && <button type="button" onClick={p.onChangeDay} data-testid="corr-change-day" className="min-h-[40px] rounded-full border border-emerald-500 px-3 text-[14px] font-extrabold text-emerald-800">{words.changeDay}</button>}
                            </div>
                            {!p.canMove && <p className="m-0 px-0.5 text-[13px] font-bold text-stone-600" data-testid="corr-move-not-yet">{words.moveNotYet}</p>}

                            <div className="space-y-1.5" data-testid="corr-rows">
                                {p.rows.map(r => <Row key={`${r.bucket}:${r.id}`} row={r} onEdit={() => p.onEditRow(r)} onToggle={() => p.onToggleRow(r)} />)}
                                {p.blockers.gone.map(b => (
                                    <div key={`gone-${b.id}`} className="rounded-xl opacity-70 line-through" data-testid={`corr-blocker-gone-${b.id}`}><BlockerRow entry={b} /></div>
                                ))}
                                {p.blockers.after.map(b => (
                                    <div key={b.id} className={p.blockers.changed ? 'rounded-xl ring-2 ring-emerald-500' : ''} data-testid={`corr-blocker-${b.id}`}><BlockerRow entry={b} /></div>
                                ))}
                            </div>
                            {p.keepOne && <p className="m-0 rounded-xl bg-amber-50 p-2.5 text-[14px] font-bold text-amber-900" data-testid="corr-keep-one">{words.keepOne}</p>}
                            <button type="button" onClick={p.onAdd} data-testid="corr-add"
                                className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50 text-[16px] font-extrabold text-emerald-800">
                                <Plus size={18} aria-hidden="true" />{words.add}
                            </button>

                            {/* 4. Save. */}
                            {p.confirmed && p.changed && <p className="m-0 px-0.5 text-[13px] font-bold text-stone-700" data-testid="corr-reconfirm">{words.reconfirm}</p>}
                            <button type="button" onClick={p.onSave} disabled={!p.changed || p.saving} data-testid="corr-save"
                                className="min-h-[56px] w-full rounded-2xl bg-emerald-700 text-[18px] font-extrabold text-white disabled:bg-stone-300">
                                {p.saving ? words.saving : words.save}
                            </button>
                            {p.saveFailed && <p className="m-0 text-[14px] font-bold text-red-700" data-testid="corr-save-failed">{p.saveFailedReason === 'labour' ? words.saveFailedLabour : words.saveFailed}</p>}
                            <p className="m-0 px-0.5 text-[13px] font-semibold text-stone-600">{words.versionNote}</p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CorrectionScreen;
