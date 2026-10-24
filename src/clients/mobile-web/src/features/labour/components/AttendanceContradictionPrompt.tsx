/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the PARKED
 * contradiction's surface: the card the labour route renders when the server
 * refused a mark with ShramSafal.AttendanceContradiction and the question is
 * waiting for the farmer.
 *
 * This is AttendanceResult.tsx's State D card (mockup 04), verbatim in copy
 * and shape — same ATTENDANCE_COPY strings, same two-facts-as-buttons
 * answer, NO new Marathi — carried to the route the EditSurfaceRegistry
 * already points at. The one difference is what answering DOES: State D
 * records a pre-save ruling; this card's answer re-enqueues the parked mark
 * with resolvedLabourAssignmentId (attendanceParked.ts owns that write).
 */
import React from 'react';
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';
import type { ContradictionFact, ContradictionQuestion } from '../data/attendanceParked';

const shiftWord = (s: ContradictionFact['shift']): string => COPY.markWord[s];

const AttendanceContradictionPrompt: React.FC<{
    question: ContradictionQuestion;
    onAnswer: (fact: ContradictionFact) => void;
}> = ({ question, onAnswer }) => {
    // One button per DISTINCT fact; the first engagement carrying the chosen
    // shift is the one the answer sides with (deterministic, in log order).
    const distinct: ContradictionFact[] = [];
    for (const fact of question.facts) {
        if (!distinct.some((f) => f.shift === fact.shift)) distinct.push(fact);
    }

    return (
        <div data-testid="attendance-contradiction"
            className="mx-4 mt-2 rounded-2xl border border-emerald-200 bg-white p-4 shadow-[0_1px_3px_rgba(20,40,30,0.05)]"
            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>
            <div className="text-[15px] font-extrabold text-emerald-700">{COPY.contradictionTitle}</div>
            <p className="mt-1.5 text-[15px] font-bold leading-snug text-slate-800">
                {COPY.contradictionBody(
                    question.name,
                    shiftWord(distinct[0].shift),
                    shiftWord((distinct[1] ?? distinct[0]).shift))}
            </p>
            <div className="mt-2.5 flex gap-2">
                {distinct.map((fact) => (
                    <button key={fact.shift} type="button"
                        onClick={() => onAnswer(fact)}
                        className={`flex-1 rounded-[14px] py-3 text-[16px] font-extrabold ${fact.shift === 'full'
                            ? 'bg-emerald-600 text-white'
                            : 'border border-amber-200 bg-white text-amber-700'}`}>
                        {shiftWord(fact.shift)}
                    </button>
                ))}
            </div>
            <p className="mt-2 text-[12px] text-slate-500">{COPY.contradictionReassurance}</p>
        </div>
    );
};

export default AttendanceContradictionPrompt;
