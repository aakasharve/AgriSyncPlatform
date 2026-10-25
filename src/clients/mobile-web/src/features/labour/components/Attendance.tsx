/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Attendance — the manual हजेरी घ्या screen: WHO came on a day (today, unless he picks another), by tapping.
 *
 * WHICH DAY (spec: plr-d10, WP-1 A9): today by default; when the host offers a choice, chips
 * at the top pick today or one of the six days before it (`attendanceDay.ts` says when that is
 * safe, and why it usually is not). Changing the day clears what was tapped.
 *
 * FOUNDER RULING 2026-08-31 — the single way in to SPEAKING is the hub hero
 * ("बोलून हजेरी घ्या"); this screen has no mic.
 *
 * WHAT THIS SCREEN SAYS (and nothing else):
 *   per person  आला / अर्धा / आला नाही  +  रात्र  (+ optional तास / जादा तास)
 *   Nothing is pre-selected. A person the farmer does not touch gets NO mark —
 *   untouched is not absent (rule 4).
 *   The ONLY save is `बरोबर`, and the line above it says nothing is kept
 *   until it is pressed. There is no approval step in an attendance mark and
 *   this screen does not pretend there is (LD D7).
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE (all deleted, none replaced):
 *   - a "how many people" counter — the Work Log owns the participation count
 *     (LD D9.2); a second typed count was collected and discarded (it never
 *     reached the payload) and seeded `?? 0`, turning unknown into zero;
 *   - a global shift card — it applied one shift to everyone and mapped
 *     "absent + night" to a day fact nobody stated;
 *   - a minimum-names rule or a "+ 2 जण" rounding note — neither was enforced
 *     and the second would invent people (attribution never changes a count).
 *
 * NO-WORK MODE (`mode="no-work"`): the same screen, opened from the hub's
 * `काम झालं नाही, पण मजूर आले` door when no work was logged. It asks WHO came
 * and (optionally, P9) WHY there was no work, reusing the six existing
 * no-work reason chips. The reason is optional: skipping saves.
 *
 * The people list, the offline roster cache and "नाव जोडा" live in
 * `AttendanceRoster`; the status -> wire mapping lives in `attendanceManual`.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { LabourData } from '../labourMock';
import type { BucketIssueType } from '../../../domain/types/log.types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { t as translate } from '../../../i18n/translations';
import { NO_WORK_CAUSES } from '../../logs/components/NoWorkReasonSheet';
import { ATTENDANCE_COPY } from '../attendanceCopy';
import {
    EMPTY_PREFILL,
    prefillFromCell,
    toMarkPayload,
    effectivePresentIds,
    type ManualMarkFacts,
    type PersonPrefill,
    type PersonSelection,
} from '../attendanceManual';
import { findMarkedAboveStated } from '../attendanceDisagreement';
import { workDateChipLabel } from '../attendanceDay';
import AttendanceRoster from './AttendanceRoster';
import HeadcountDisagreementCard from './HeadcountDisagreementCard';

/** One person's stated facts — only people the farmer actually stated something about. */
export type ManualAttendanceMark = { fieldOperatorId: string } & ManualMarkFacts;

export type AttendanceMode = 'normal' | 'no-work';

interface Props {
    /** Read ONLY for the chosen day's register cells (prefill); never for who to list. */
    data: LabourData;
    /**
     * spec: plr-d10 (WP-1 A9) — the day these marks are for (`yyyy-MM-dd`); today when absent.
     * Chosen from `workDates` by the chips at the top, which show only when there is a choice.
     */
    workDate?: string;
    workDates?: readonly string[];
    onWorkDateChange?: (workDate: string) => void;
    /** undefined = no farm context: nothing can be listed, added or saved. */
    farmId: string | undefined;
    mode?: AttendanceMode;
    /**
     * The day's REPORTED headcount (work log anchor, else the server's read-out
     * of the day); null = nobody stated one. Read-only: used to show when more
     * people are marked present than that, never to change either number.
     */
    statedHeadcount?: number | null;
    /**
     * Persist the marks. Resolves when they are safely queued; rejects when
     * they were not (the screen then re-enables and the farmer can retry).
     * `noWorkCause` is only ever set in no-work mode, and only when a chip
     * was chosen.
     */
    onSave: (marks: ManualAttendanceMark[], noWorkCause?: BucketIssueType) => Promise<void>;
    onToast: (m: string) => void;
}

/** D9.6 — the no-work question is WHO + WHY, no count. */
const NO_WORK_QUESTION = 'आज कोण आले होते आणि काम का झालं नाही?';

const Attendance: React.FC<Props> = ({
    data, farmId, workDate, workDates, onWorkDateChange, mode = 'normal', statedHeadcount = null, onSave, onToast,
}) => {
    const todayKey = getDateKey();
    const day = workDate ?? todayKey;
    const [selections, setSelections] = useState<Record<string, PersonSelection>>({});
    const [cause, setCause] = useState<BucketIssueType | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    // A ref, not just state: two taps in the same tick both see `saving`
    // false from the same render. One press = one save.
    const savingRef = useRef(false);

    // What he tapped was about the day he had chosen; another day starts clean.
    const [selectionsDay, setSelectionsDay] = useState(day);
    if (selectionsDay !== day) {
        setSelectionsDay(day);
        setSelections({});
    }

    // The chosen day's register cell per person (read-only context). The
    // register already composes the device's queued marks over the server's
    // rows, so a re-opened screen shows what is already recorded.
    const prefills = useMemo(() => {
        const out: Record<string, PersonPrefill> = {};
        const dayIndex = data.ledger.days.indexOf(day);
        if (dayIndex < 0) return out;
        for (const row of data.ledger.rows) {
            out[row.fieldOperatorId] = prefillFromCell(row.cells[dayIndex]);
        }
        return out;
    }, [data.ledger, day]);

    // The stated headcount is TODAY's; on another day there is none to compare with.
    const dayHeadcount = day === todayKey ? statedHeadcount : null;
    const showDayChoice = mode === 'normal' && Boolean(onWorkDateChange) && (workDates?.length ?? 0) > 1;

    const marks = useMemo<ManualAttendanceMark[]>(() => Object.entries(selections).flatMap(([id, sel]) => {
        const facts = toMarkPayload(sel, prefills[id] ?? EMPTY_PREFILL);
        return facts ? [{ fieldOperatorId: id, ...facts }] : [];
    }), [selections, prefills]);

    // D2 - more named people marked present than the day's stated headcount:
    // shown through the existing disagreement card, never resolved here.
    const presentIds = useMemo(() => effectivePresentIds(selections, prefills), [selections, prefills]);
    const aboveStated = useMemo(
        () => findMarkedAboveStated(dayHeadcount, presentIds),
        [dayHeadcount, presentIds],
    );

    const canSave = Boolean(farmId) && marks.length > 0 && !saving;

    const save = async () => {
        if (!canSave || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            await onSave(marks, mode === 'no-work' ? cause : undefined);
        } catch {
            // The host has already said what went wrong; stay on the screen.
            savingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-2.5 px-4 pb-24 pt-2" data-testid="attendance-screen">
            {showDayChoice && (
                <div data-testid="att-day-choice" className="flex flex-col gap-2">
                    <div className="px-1 pt-1 text-[17px] font-bold text-stone-800">{ATTENDANCE_COPY.dayChoiceQuestion}</div>
                    <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={ATTENDANCE_COPY.dayChoiceQuestion}>
                        {workDates!.map((d) => (
                            <button key={d} type="button" disabled={saving}
                                data-testid={`att-workdate-${d}`}
                                aria-pressed={d === day}
                                onClick={() => { if (d !== day) onWorkDateChange!(d); }}
                                className={`min-h-[48px] flex-none rounded-xl border px-4 py-2 text-[16px] font-extrabold transition-colors ${d === day ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-500'}`}>
                                {workDateChipLabel(d, todayKey)}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {mode === 'no-work' && (
                <>
                    <div data-testid="att-no-work-question" className="px-1 pt-1 text-[19px] font-bold text-stone-800">{NO_WORK_QUESTION}</div>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={NO_WORK_QUESTION}>
                        {NO_WORK_CAUSES.map(({ cause: c, labelKey }) => (
                            <button key={c} type="button" disabled={saving}
                                data-testid={`att-cause-${c}`}
                                aria-pressed={cause === c}
                                onClick={() => setCause((cur) => (cur === c ? undefined : c))}
                                className={`min-h-[48px] rounded-xl border px-4 py-2 text-[16px] font-extrabold transition-colors ${cause === c ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-500'}`}>
                                {translate(`dfes.noWorkReason.${labelKey}`, 'mr')}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <AttendanceRoster
                farmId={farmId}
                selections={selections}
                prefills={prefills}
                onChange={(id, next) => setSelections((cur) => ({ ...cur, [id]: next }))}
                onToast={onToast}
                disabled={saving}
            />

            {aboveStated && <HeadcountDisagreementCard disagreement={aboveStated} markedCount={presentIds.length} />}

            <p data-testid="att-honesty" className="px-1 pt-1 text-[16px] leading-snug text-stone-600">{ATTENDANCE_COPY.preSaveHonesty}</p>
            <button type="button" data-testid="att-save" disabled={!canSave}
                onClick={() => void save()}
                className={`flex min-h-[56px] w-full items-center justify-center gap-2 rounded-[14px] py-3.5 text-[19px] font-extrabold text-white transition-transform active:scale-[0.98] ${canSave ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                <Check size={20} /> {ATTENDANCE_COPY.confirmButton}
            </button>
        </div>
    );
};

export default Attendance;
