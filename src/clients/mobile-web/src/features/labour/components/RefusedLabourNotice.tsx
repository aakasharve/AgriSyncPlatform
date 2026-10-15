/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RefusedLabourNotice - the calm, plain statement that something the farmer
 * took on this phone did NOT reach the farm record, and (when the server's own
 * code says so) why.
 *
 * Journey fixes D1 + D6 (spec 2026-08-25-prod-cutover-waves). `लक्षात ठेवलं ✓`
 * at save time is true and stays: it means "queued on this phone". This card
 * is what the farmer sees AFTERWARDS when the server refused it. Rules:
 *   - it states a count and, only for a Forbidden verdict, the reason - in the
 *     founder's own words (जबाबदारी), never raw JSON, never English;
 *   - it never names a person it cannot name (no name = no name shown);
 *   - it changes no number and builds no queue: the rows it reads are the ones
 *     the ⚠ badge already counts (attendanceRefused.ts), and the one action is
 *     the existing retry.
 */
import React, { useState } from 'react';
import { ATTENDANCE_COPY as COPY } from '../attendanceCopy';
import { formatWindowRange } from '../marathiDate';
import type { RefusedLabourMark, RefusedLabourState } from '../data/attendanceRefused';

/** The register's existing chip label for a stated absence. */
const ABSENT_WORD = 'आला नाही';

const dayWord = (m: RefusedLabourMark): string[] => [
    m.dayMark === 'Full' ? COPY.markWord.full
        : m.dayMark === 'Half' ? COPY.markWord.half
            : m.dayMark === 'Absent' ? ABSENT_WORD : '',
    m.nightMark === 'Worked' ? COPY.markWord.night : '',
].filter((w) => w !== '');

const RefusedLabourNotice: React.FC<{
    state: RefusedLabourState;
    /** undefined = unknown: the row then shows no name rather than a guess. */
    nameOf: (fieldOperatorId: string) => string | undefined;
    onRetry: () => void;
}> = ({ state, nameOf, onRetry }) => {
    const [open, setOpen] = useState(false);
    const { marks, noWorkDeclarationRefused } = state;
    if (marks.length === 0 && !noWorkDeclarationRefused) return null;
    const allMissingResponsibility = marks.length > 0 && marks.every((m) => m.missingResponsibility);

    return (
        <div data-testid="labour-refused-notice" role="status"
            className="mx-4 mt-2 rounded-2xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50 p-4">
            {marks.length > 0 && (
                <div data-testid="labour-refused-marks">
                    <p className="text-[19px] font-bold leading-snug text-stone-800">{COPY.refusedMarksTitle(marks.length)}</p>
                    {allMissingResponsibility && (
                        <p data-testid="labour-refused-reason" className="mt-1 text-[16px] leading-snug text-stone-700">{COPY.refusedMissingResponsibility}</p>
                    )}
                    <button type="button" data-testid="labour-refused-show" aria-expanded={open}
                        onClick={() => setOpen((o) => !o)}
                        className="mt-2 min-h-[48px] rounded-xl border border-amber-300 bg-white px-4 text-[16px] font-extrabold text-amber-800">
                        {COPY.refusedShowWhich}
                    </button>
                    {open && (
                        <ul data-testid="labour-refused-list" className="mt-2 space-y-1.5">
                            {marks.map((m) => {
                                const name = nameOf(m.fieldOperatorId);
                                const when = formatWindowRange(m.workDate, m.workDate);
                                return (
                                    <li key={m.clientRequestId} className="text-[16px] text-stone-800">
                                        {[name, when, dayWord(m).join(' · ')].filter((x) => x).join(' · ')}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
            {noWorkDeclarationRefused && (
                <p data-testid="labour-refused-noWork" className={`${marks.length > 0 ? 'mt-3 ' : ''}text-[19px] font-bold leading-snug text-stone-800`}>{COPY.noWorkNotRecorded}</p>
            )}
            <button type="button" data-testid="labour-refused-retry" onClick={onRetry}
                className="mt-3 min-h-[48px] w-full rounded-xl bg-amber-600 px-4 text-[16px] font-extrabold text-white">
                {COPY.refusedRetry}
            </button>
        </div>
    );
};

export default RefusedLabourNotice;
