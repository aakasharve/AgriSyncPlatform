/**
 * Labour V2 R1 Task 3.4b — the Labour-owned parse result (founder D1–D3,
 * locked as drawn; mockup 01 frame 3 / 05).
 *
 * OWNERSHIP, NOT REBUILDING: the mic shell, the segment re-record path and
 * the ShramSathi processing screen stay shared (mainView renders them); this
 * screen owns only the MEANING of a labour parse and its confirm. बरोबर is
 * the ONLY save event in this flow (trust rule 5; pre-save honesty line is
 * founder copy). बदल करा renders the existing ManualEntry(attendanceOnly)
 * branch — the old landing became the edit surface.
 *
 * Money never appears here (state A "must not": no ₹, no rate, no wage).
 */
import React from 'react';
import { Check, Mic, Pencil } from 'lucide-react';
import type { AgriLogResponse } from '../../../types';
import type { LabourAnchor } from '../labourAnchor';
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';
import { selectLadderRung } from '../attendanceLadder';
import { findDayContradictions, type DayContradiction, type DayShift } from '../attendanceContradiction';
import { selectConfirmSurface } from '../attendanceDisagreement';
import { resolveLabourHeadcount } from '../../../domain/logs/labourHeadcount';

export interface AttendanceResultProps {
    /** Attendance-only draft (labour.length > 0) — toAttendanceOnlyDraft output. */
    draft: AgriLogResponse;
    anchor: LabourAnchor;
    /** meta.farmId of the anchor log / context farm — undefined ⇒ marks are skipped, statement still saves. */
    farmId: string | undefined;
    /** THE only save. Wired to useLogCommands.handleManualSubmit. */
    onConfirm: (draft: AgriLogResponse) => void;
    /** बदल करा → the existing ManualEntry(attendanceOnly) branch. */
    renderEditSurface: () => React.ReactNode;
    /** Rungs 2/3 "speak" → setRecordingSegment('labour'); setMode('voice'). */
    onSpeakMore: () => void;
}

const shiftWord = (s: DayShift): string => COPY.markWord[s];

const AttendanceResult: React.FC<AttendanceResultProps> = ({
    draft, anchor, farmId, onConfirm, renderEditSurface, onSpeakMore,
}) => {
    void farmId; // consumed by 3.5c's enqueue block; carried in the props contract now.
    const [editing, setEditing] = React.useState(false);
    // State D answers, keyed by name. Recorded beside the statements, never in
    // place of them (mockup 04 "never silently overwrite").
    const [rulings, setRulings] = React.useState<Record<string, DayShift>>({});

    const spokenCounts = draft.labour
        .map((e) => resolveLabourHeadcount(e))
        .filter((n): n is number => n != null);
    const spokenCount = spokenCounts.length > 0 ? spokenCounts.reduce((a, b) => a + b, 0) : undefined;
    const anchorHeadcount = anchor.state === 'anchored' ? anchor.headcount : undefined;
    const workerNames = draft.labour.flatMap((e) => e.workerNames ?? []);
    // Carried 3.3-review MINOR: dedup names for DISPLAY the way
    // attendanceDisagreement dedups for detection — a duplicated parse name
    // must not render as two chips. Exact-string only; identity resolution
    // stays at resolution (rule 10), never here.
    const displayNames = [...new Set(workerNames)];
    const rung = selectLadderRung({ anchorHeadcount, spokenCount, workerNames });
    const knownCount = spokenCount ?? anchorHeadcount;
    // ── B001 (3.3 review, controller ruling) ─────────────────────────────
    // Disagreement detection is NOT computed inline. The ruled gate is
    // selectConfirmSurface (attendanceDisagreement.ts): it covers BOTH axes —
    // spoken-vs-anchor (12-vs-10) AND count-vs-composition (0-with-names,
    // superset, duplicate-masked) — and makes the plain 'confirm' kind
    // structurally underivable while any conflict stands. Bypassing it here
    // re-opens the exact one-tap-confirm-of-a-contradiction hole Task 3.3
    // closed. Its module header carries the render contract this component
    // must honour.
    const surface = selectConfirmSurface({
        anchor,
        events: draft.labour,
    });
    const disagreement = surface.kind === 'confirm-with-disagreement' ? surface.disagreement : null;
    const contradictions: DayContradiction[] = findDayContradictions(draft.labour)
        .filter((c) => rulings[c.name] == null);

    if (editing) return <>{renderEditSurface()}</>;

    const question = rung === 2 && knownCount != null ? COPY.rungWho(knownCount)
        : rung === 3 ? COPY.rungRemainder
        : rung === 4 ? COPY.rungConfirm
        : null;

    return (
        <div className="flex flex-col gap-2.5" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
            {/* ShramSafalला समजलं — what memory already holds + what was heard */}
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                <div className="text-[13px] font-extrabold text-slate-800">{COPY.understoodHeading}</div>
                {knownCount != null && (
                    <div className="mt-2 flex items-center gap-2">
                        <b className="text-[24px] font-black text-emerald-700 [font-variant-numeric:tabular-nums]" style={{ fontFamily: "'DM Sans', sans-serif" }}>{knownCount}</b>
                        <span className="text-[15px] font-bold text-slate-700">जण</span>
                        <span className="ml-auto rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">{COPY.youSaidChip}</span>
                    </div>
                )}
                {displayNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {displayNames.map((name) => (
                            <span key={name} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-bold text-slate-800">{name}</span>
                        ))}
                    </div>
                )}
                {/* D9.5 — sourceText first, then the reading taken. Settled by
                    बरोबर / बदल करा below; NEVER raised as a separate question.
                    "Shankarसोबत 8" stays ONE fact under Shankar's own line —
                    never folded into his cell, never 8 invented names. */}
                {draft.labour.filter((e) => e.sourceText).map((e) => (
                    <div key={e.id} className="mt-2 border-t border-slate-100 pt-2">
                        <span className="block text-[12.5px] text-slate-600">{COPY.youSaidChip}: “{e.sourceText}”</span>
                        {e.systemInterpretation && (
                            <span className="mt-0.5 block text-[12px] font-bold text-violet-700">{e.systemInterpretation}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Headcount disagreement — both statements visible, neither overwritten
                (rule 1). Rendered from the ruled gate's own preserved fields, never
                re-derived: spoken.count is null when only names were spoken (B001's
                0-with-names), and printing a fabricated number here would be the
                exact silent overwrite this card exists to prevent. */}
            {disagreement && (
                <div data-testid="headcount-disagreement"
                    className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-800">
                    <span className="font-extrabold">
                        {COPY.youSaidChip}: {disagreement.spoken.count != null
                            ? <>{disagreement.spoken.count} जण.</>
                            : <>{disagreement.uniqueNames.join(', ')}.</>}
                    </span>
                    {disagreement.anchored != null && (
                        <> आजच्या कामाच्या नोंदीत {disagreement.anchored.headcount} जण आहेत.</>
                    )}
                    {' '}दोन्ही नोंदी तशाच राहतील.
                </div>
            )}

            {/* State D — the one question, answered by the two facts themselves. */}
            {contradictions.map((c) => {
                const distinct = [...new Set(c.facts.map((f) => f.shift))];
                return (
                    <div key={c.name} className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                        <div className="text-[15px] font-extrabold text-emerald-700">{COPY.contradictionTitle}</div>
                        <p className="mt-1.5 text-[15px] font-bold leading-snug text-slate-800">
                            {COPY.contradictionBody(c.name, shiftWord(distinct[0]), shiftWord(distinct[1] ?? distinct[0]))}
                        </p>
                        <div className="mt-2.5 flex gap-2">
                            {distinct.map((s) => (
                                <button key={s} type="button"
                                    onClick={() => setRulings((r) => ({ ...r, [c.name]: s }))}
                                    className={`flex-1 rounded-[14px] py-3 text-[16px] font-extrabold ${s === 'full'
                                        ? 'bg-emerald-600 text-white'
                                        : 'border border-amber-200 bg-white text-amber-700'}`}>
                                    {shiftWord(s)}
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-[12px] text-slate-500">{COPY.contradictionReassurance}</p>
                    </div>
                );
            })}

            {/* The rung's one question + the shared mic as the way to answer it. */}
            {question && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                    <p className="text-[19px] font-bold leading-snug text-stone-800">{question}</p>
                    {(rung === 2 || rung === 3) && (
                        <button type="button" onClick={onSpeakMore}
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3 text-[14px] font-extrabold text-emerald-700 active:scale-[0.98]">
                            <Mic size={16} /> बोला
                        </button>
                    )}
                </div>
            )}

            {/* Pre-save honesty + the ONLY save. Disabled while a contradiction is unanswered. */}
            <p className="px-1 text-[12.5px] font-bold text-slate-500">{COPY.preSaveHonesty}</p>
            <div className="flex gap-2">
                <button type="button" disabled={contradictions.length > 0}
                    onClick={() => onConfirm(draft)}
                    className={`flex flex-[2] items-center justify-center gap-2 rounded-[14px] py-3.5 text-[16px] font-extrabold text-white transition-transform active:scale-[0.98] ${contradictions.length > 0 ? 'bg-slate-300' : 'bg-emerald-600'}`}>
                    <Check size={18} /> {COPY.confirmButton}
                </button>
                <button type="button" onClick={() => setEditing(true)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white py-3.5 text-[15px] font-extrabold text-slate-700 active:scale-[0.98]">
                    <Pencil size={16} /> {COPY.editButton}
                </button>
            </div>
        </div>
    );
};

export default AttendanceResult;
