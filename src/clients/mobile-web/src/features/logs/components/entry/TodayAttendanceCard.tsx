/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder instruction ATT-LOG (2026-10-31, register F81), built from his design page
 * `G:\VALIDATION\PRODUCT CHANGES\ATTENDANCE-log` (wording ruled correct the same day):
 *
 *   - until today's work AND how many people worked are both told: an EMPTY card (dashed outline) titled "आजची हजेरी",
 *     the rule in big text, one line per point — a green tick for what is told, orange for what is missing — and ONE
 *     button: "आधी आजचं काम सांगा" (nothing told / the work missing) or "किती जण होते ते सांगा" (only the count missing).
 *     Founder 2026-10-31 + rule CTX-1: that button opens the crop question first (कोणत्या पिकावर काम झालं ?), then the
 *     plot, then the mic, exactly as "झालेले काम सांगा" (the caller hands in that same step) — never the mic directly;
 *     typing stays on the plot step (TAP-1).
 *   - both told: "इथे हजेरी घ्या — आज N जण", and the card opens the हजेरी screen's names. N is the हजेरी rule's own
 *     count (`todayAttendance.ts`); a count nobody confirmed yet carries "खात्री बाकी" (D-46); unknown is "—" (P4).
 *
 * Only someone who may take हजेरी is handed this card (the caller decides, by the same door rule as before).
 */
import React from 'react';
import { Check, Hand } from 'lucide-react';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { workTypeNameIn } from '../../../../shared/names/namesIn';
import { placeWords } from '../../../../shared/names/placeWords';
import { SANS, Tap } from '../../../../shared/components/ui/placeUi';
import { partNameIn } from '../voiceResult/partNames';
import { attendanceCardWords, type AttendanceCardWords } from './attendanceCardWords';
import type { DayWork, TodayAttendance } from './todayAttendance';

export interface TodayAttendanceCardProps {
    state: TodayAttendance;
    /** The empty card's button: the crop → plot → mic steps of "झालेले काम सांगा". */
    onTell: () => void;
    /** Both told: the हजेरी screen's names. Absent = the ready card is shown without a door. */
    onOpenNames?: () => void;
    /** The quiet way to the हजेरी place (its वही, आढावा, people) that the old door gave. Absent = not drawn. */
    onOpenRegister?: () => void;
}

/** "खुरपणी, पाणी" — the jobs in his language (a name the list does not know in it is left out), then the unnamed parts. */
export function workText(work: DayWork, language: string | null | undefined): string {
    const named = work.names.map(n => workTypeNameIn(n, language, { strict: true })).filter(Boolean);
    const parts = work.parts.map(p => partNameIn(p, language));
    return [...new Set([...named, ...parts])].slice(0, 3).join(', ');
}

/** "द्राक्ष · G1" — where the work was done, crop names strictly in his language; the whole farm by its own name. */
export function placeText(work: DayWork, language: string | null | undefined, W: AttendanceCardWords): string {
    const place = work.place;
    if (!place) return '';
    if (place.cropId === 'FARM_GLOBAL') return W.wholeFarm;
    // A plot named after its crop ("द्राक्ष G1") already says the crop: never "द्राक्ष · द्राक्ष G1" (the shared rule).
    return placeWords(place.cropName, place.plotNames, language);
}

const countText = (n: number | null): string => (n === null ? '—' : String(n));

const Point: React.FC<{ told: boolean; text: string; testId: string; extra?: React.ReactNode }> = ({ told, text, testId, extra }) => (
    <span data-testid={testId} data-told={told ? 'yes' : 'no'}
        className={`flex items-center gap-2 text-[15.5px] font-extrabold leading-snug ${told ? 'text-emerald-700' : 'text-amber-700'}`}>
        <i aria-hidden="true" className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full not-italic text-[13px] text-white ${told ? 'bg-emerald-500' : 'bg-amber-500'}`}>
            {told ? <Check size={14} strokeWidth={3} /> : '!'}
        </i>
        <span className="min-w-0">{text}</span>
        {extra}
    </span>
);

export const TodayAttendanceCard: React.FC<TodayAttendanceCardProps> = ({ state, onTell, onOpenNames, onOpenRegister }) => {
    const language = useOptionalLanguage()?.language;
    const W = attendanceCardWords(language);
    const what = state.work ? workText(state.work, language) : '';
    const where = state.work ? placeText(state.work, language, W) : '';
    const provisionalChip = state.provisional ? (
        <span data-testid="attendance-card-provisional" className="ml-1 shrink-0 rounded-lg bg-amber-50 px-2 py-0.5 text-[12px] font-bold text-amber-800">{W.provisional}</span>
    ) : null;
    const register = onOpenRegister ? (
        <button type="button" onClick={onOpenRegister} data-testid="attendance-card-register"
            className="mx-auto mt-1 block min-h-[44px] px-3 text-[15px] font-bold text-stone-700 underline decoration-stone-400 underline-offset-4">
            {W.register}
        </button>
    ) : null;

    if (state.work && state.headcount !== null) {
        const inside = (
            <>
                <span className="flex flex-wrap items-center gap-x-1 text-[20px] font-extrabold leading-snug" data-testid="attendance-card-ready">
                    {W.ready(countText(state.headcount))}{provisionalChip}
                </span>
                <span className="mb-2.5 mt-1 block text-[13px] font-bold text-stone-600">{W.readyLine(what && where ? `${what} (${where})` : what || where)}</span>
                {onOpenNames && <span className="block min-h-[48px] w-full rounded-[13px] bg-amber-500 py-[11px] text-center text-[16px] font-extrabold text-stone-900">{W.take}</span>}
            </>
        );
        const look = 'block w-full rounded-[18px] border-2 border-amber-300 bg-amber-50 p-[13px] text-left text-stone-900';
        return (
            <div style={{ fontFamily: SANS }}>
                {onOpenNames ? (
                    <Tap onClick={onOpenNames} data-testid="attendance-card" data-state="ready" rippleColor="rgba(245,158,11,0.25)" className={look}>{inside}</Tap>
                ) : (
                    <div data-testid="attendance-card" data-state="ready" className={look}>{inside}</div>
                )}
                {register}
            </div>
        );
    }

    const workTold = state.work !== null;
    const countTold = state.headcount !== null;
    return (
        <div style={{ fontFamily: SANS }}>
            <section data-testid="attendance-card" data-state={workTold ? 'work-told' : countTold ? 'count-told' : 'empty'}
                className="rounded-[18px] border-[3px] border-dashed border-stone-300 bg-white p-[14px]">
                <div className="mb-2 flex items-center gap-2 text-[15px] font-extrabold text-stone-500">
                    <Hand size={22} strokeWidth={2} aria-hidden="true" />{W.title}
                </div>
                <p className="m-0 text-[21px] font-extrabold leading-snug text-stone-900" data-testid="attendance-card-rule">{W.rule}</p>
                <div className="mb-1 mt-3 flex flex-col gap-1.5">
                    <Point told={workTold} testId="attendance-card-work" text={workTold ? W.workTold(what) : W.workMissing} />
                    <Point told={countTold} testId="attendance-card-count" text={countTold ? W.countTold(countText(state.headcount)) : W.countMissing}
                        extra={countTold ? provisionalChip : null} />
                </div>
                <button type="button" onClick={onTell} data-testid="attendance-card-tell"
                    className="mt-2.5 min-h-[52px] w-full rounded-[13px] bg-emerald-700 px-3 py-[11px] text-[16px] font-extrabold text-white active:scale-[0.98]">
                    {workTold ? W.tellCount : W.tellWork}
                </button>
            </section>
            {register}
        </div>
    );
};

export default TodayAttendanceCard;
