/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — "बदला" by speaking: the founder's screen 4 ("बदला —
 * पर्याय 2: फक्त बोलून बदला"), chosen 2026-10-30. Presentational; `core/speak/CorrectionHost` owns the data and the save.
 *
 *   1. "आत्ता जे आहे" — the entry's current parts, read-only, the result screen's own rows (`AddedRow`, `BlockerRow`);
 *   2. one big mic, "जे बदलायचं ते बोलून सांगा", with example lines — it opens THE ONE mic (lane MIC-1);
 *   3. after he speaks, back here: before → after — a changed part is outlined and tagged "बदललं", its old value struck
 *      through; "पुन्हा सांगा" (forget it, speak again) and "जतन करा" (the only thing that saves).
 * A record the हजेरी door saved is not changed here (lane F1 refuses it); the screen says so politely.
 * Fix pass: every value reads as on the result screen ("इथरेल · 300 मिली"), never his quoted words; a removed stoppage is
 * struck through like any removed value; workers he spoke of that cannot be changed here say where they can be; with
 * no internet the mic does not record (a change needs it) and the screen says so.
 * No pencil, no form (the founder: "लिहून बदलण्याची सोय नाही — फक्त बोलून").
 */
import React from 'react';
import { ArrowLeft, Mic, Users } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { PHONE_COLUMN } from '../phoneColumn';
import { AddedRow, BlockerRow, TypedTag } from '../voiceResult/DayParts';
import { PartIcon } from '../voiceResult/HisWords';
import { entryText, partNameIn } from '../voiceResult/partNames';
import { partMeta, type BlockerEntry, type PartEntry } from '../voiceResult/resultModel';
import { correctionWords } from './correctionWords';
import { goneValues, type CorrectionRow } from './correctionModel';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface CorrectionScreenProps {
    /** "रात्री 8:02", when the entry has a time. */
    timeLabel: string;
    /** "द्राक्ष · G1", or the whole farm. */
    placeLabel: string;
    confirmed: boolean;
    /** The entry now, the result screen's way. */
    current: { entries: readonly PartEntry[]; blockers: readonly BlockerEntry[] };
    /** What he said and what it changes; absent until he has spoken. */
    proposal?: {
        transcript: string;
        typed: boolean;
        rows: readonly CorrectionRow[];
        blockers: { before: readonly BlockerEntry[]; after: readonly BlockerEntry[]; gone: readonly BlockerEntry[]; changed: boolean };
        /** Nothing in his words changes the entry. */
        nothing: boolean;
        /** He spoke about workers in a way this screen cannot change (review B001). */
        labourNotChanged?: boolean;
    };
    /** A हजेरी-door record: not changed here. */
    refused: boolean;
    saving: boolean;
    saveFailed: boolean;
    /** Why the save failed: the labour numbers (they need the internet), or anything else. */
    saveFailedReason?: 'labour' | 'other';
    /** No internet: the mic does not record (review B004). */
    offline?: boolean;
    /** A change saved earlier was refused by the server (review B002): said plainly, never "sent". */
    serverRefused?: boolean;
    onSpeak: () => void;
    onAgain: () => void;
    onSave: () => void;
    onBack: () => void;
    /** Present only for someone who may open हजेरी (never a dead button, P5). */
    onOpenAttendance?: () => void;
}

/** One part after his words: the result screen's row look; changed = outlined + "बदललं", the old value struck through. */
const PartRow: React.FC<{ row: CorrectionRow; language: string | undefined }> = ({ row, language }) => {
    const words = correctionWords(language);
    const m = partMeta(row.part);
    const now = row.after.map(e => entryText(e, language)).filter(Boolean);
    const gone = row.changed ? goneValues(row, language) : [];
    const unsure = row.after.some(e => !e.verified);
    return (
        <div data-testid={`corr-part-${row.part}`} data-changed={row.changed ? 'yes' : 'no'}
            className={`flex items-start gap-2.5 rounded-xl border-l-4 bg-white p-2.5 ${row.changed ? 'border-emerald-600 ring-2 ring-emerald-500' : 'border-stone-300'}`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: m.tint }}><PartIcon part={row.part} size={24} /></span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-extrabold text-stone-600">
                    {partNameIn(row.part, language)}
                    {row.changed && <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11.5px] font-extrabold text-white" data-testid={`corr-changed-${row.part}`}>{words.changedTag}</span>}
                </div>
                {gone.map(v => <div key={`old-${v}`} className="text-[14px] font-bold text-stone-400 line-through" data-testid={`corr-old-${row.part}`}>{v}</div>)}
                {now.length > 0
                    ? now.map((v, i) => <div key={`now-${i}`} className={`text-[18px] leading-tight text-stone-900 ${unsure ? 'font-semibold' : 'font-extrabold'}`} data-testid={`corr-new-${row.part}`}>{v}</div>)
                    : row.after.length > 0 && <div className="text-[16px] font-extrabold text-stone-900">{partNameIn(row.part, language)}</div>}
            </div>
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
                    {!p.proposal && (
                        <>
                            <div className="px-0.5 text-[13px] font-extrabold text-stone-600">{words.nowTitle}</div>
                            <div className="space-y-1.5" data-testid="corr-now">
                                {p.current.entries.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}
                                {p.current.blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                            </div>
                        </>
                    )}

                    {p.refused ? (
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] font-bold leading-snug text-amber-950" data-testid="corr-refused">
                            <p className="m-0 flex items-start gap-2"><Users size={20} className="mt-0.5 shrink-0" aria-hidden="true" />{words.labourDoor}</p>
                            {p.onOpenAttendance && (
                                <button type="button" onClick={p.onOpenAttendance} data-testid="corr-open-attendance"
                                    className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-amber-500 bg-white text-[16px] font-extrabold text-amber-900">{words.openAttendance}</button>
                            )}
                        </div>
                    ) : !p.proposal ? (
                        <div className="pt-2 text-center">
                            {p.offline && <p className="m-0 mb-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left text-[15px] font-bold text-amber-950" data-testid="corr-offline">{words.offline}</p>}
                            <button type="button" onClick={p.onSpeak} aria-label={words.mic} data-testid="corr-mic"
                                className="mx-auto grid h-[110px] w-[110px] place-items-center rounded-full bg-emerald-700 text-white shadow-[0_8px_24px_rgba(4,120,87,0.35)] active:scale-95">
                                <Mic size={48} strokeWidth={2.25} aria-hidden="true" />
                            </button>
                            <p className="m-0 mt-2 text-[17px] font-extrabold text-stone-900" data-testid="corr-prompt">{words.speakPrompt}</p>
                            <div className="mt-2.5 rounded-2xl border border-stone-200 bg-white p-3 text-left text-[14px] font-bold leading-relaxed text-stone-800" data-testid="corr-examples">
                                {words.examples.map(x => <div key={x}>{x}</div>)}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white p-2.5 text-[14px] font-bold text-stone-800" data-testid="corr-said">
                                <span className="text-stone-600">{words.youSaid}:</span>
                                {p.proposal.typed && <TypedTag testId="corr-said-typed" />}
                                {p.proposal.transcript && <span>“{p.proposal.transcript}”</span>}
                            </div>
                            {p.proposal.labourNotChanged && (
                                <p className="m-0 rounded-2xl border border-stone-300 bg-white p-3 text-[15px] font-bold text-stone-800" data-testid="corr-labour-hajeri">{words.labourInHajeri}</p>
                            )}
                            {p.proposal.nothing ? (
                                !p.proposal.labourNotChanged && <p className="m-0 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[15px] font-bold text-amber-900" data-testid="corr-nothing">{words.nothingChanged}</p>
                            ) : (
                                <div className="space-y-1.5" data-testid="corr-after">
                                    {p.proposal.rows.map(r => <PartRow key={r.part} row={r} language={language} />)}
                                    {p.proposal.blockers.gone.map(b => (
                                        <div key={`gone-${b.id}`} className="rounded-xl opacity-70 line-through" data-testid={`corr-blocker-gone-${b.id}`}><BlockerRow entry={b} /></div>
                                    ))}
                                    {p.proposal.blockers.after.map(b => (
                                        <div key={b.id} className={p.proposal?.blockers.changed ? 'rounded-xl ring-2 ring-emerald-500' : ''} data-testid={`corr-blocker-${b.id}`}><BlockerRow entry={b} /></div>
                                    ))}
                                </div>
                            )}
                            {p.confirmed && !p.proposal.nothing && <p className="m-0 px-0.5 text-[13px] font-bold text-stone-700" data-testid="corr-reconfirm">{words.reconfirm}</p>}
                            <div className="flex gap-2 pt-1">
                                <button type="button" onClick={p.onAgain} disabled={p.saving} data-testid="corr-again"
                                    className="flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-2xl border border-stone-300 bg-white text-[16px] font-extrabold text-stone-800 disabled:opacity-50">
                                    <Mic size={18} aria-hidden="true" />{words.again}
                                </button>
                                {!p.proposal.nothing && (
                                    <button type="button" onClick={p.onSave} disabled={p.saving} data-testid="corr-save"
                                        className="min-h-[52px] flex-1 rounded-2xl bg-emerald-700 text-[16px] font-extrabold text-white disabled:opacity-60">
                                        {p.saving ? words.saving : words.save}
                                    </button>
                                )}
                            </div>
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
