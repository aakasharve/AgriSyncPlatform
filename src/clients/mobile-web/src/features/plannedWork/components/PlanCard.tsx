/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, founder D-24c, D-24a, P10) - one task or reminder as a card,
 * ported from the 25 Oct preview (`postVoiceResult/PlanCard.tsx`) onto the real task: WHAT, WHERE, WHEN, WHO, the details, who
 * planned it, and the trail सोपवलं -> पाहिलं -> स्वीकारलं -> झालं. A reminder card says "आठवण" and has no trail. A dated card past
 * its day and not finished turns red; an undated or loose one is amber and never late. A change waiting on this phone says
 * "फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल"; a parked step says its own words and opens the conflict page, and never shows as done.
 * The headcount, quantity and pay mode are shown as the words they are (P4): no हजेरी, wage or cost is drawn from them.
 * Lane L8c-3 (founder D-24d, D-30): a done task says "झालं · मंजुरी बाकी" / "झालं · मंजूर" / "झालं · शंका — मालकाशी बोला" - the owner's word on
 * the logs it was done with, TEXT ONLY (the approval door is lane L8c-5); a task done on some of its plots says "अर्धवट झालं" with a line
 * per plot ("ऊस 1 — झालं · ऊस 2 — बाकी").
 *
 * Marathi mode shows Marathi only and English mode English only (names through `shared/names/namesIn`).
 */
import React from 'react';
import { Bell, CalendarClock, Check, MapPin, User } from 'lucide-react';
import { workTypeNameIn } from '../../../shared/names/namesIn';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { parkedWords, type ParkedStep } from '../data/plannedWorkParked';
import { crewLine, isReminderTask, trailStage, TRAIL_STATUSES } from '../planCardModel';
import { whenView } from '../planDates';
import { plannedWorkWords } from '../plannedWorkWords';

const MR_FONT = "'Noto Sans Devanagari', sans-serif";
const EN_FONT = "'DM Sans', sans-serif";

export const fontFor = (language: string | null | undefined): string => (language === 'en' ? EN_FONT : MR_FONT);

export const Trail: React.FC<{ stage: number; labels: readonly string[] }> = ({ stage, labels }) => (
    <ol className="m-0 flex list-none items-start gap-0 p-0" data-testid="plan-trail" data-stage={stage} aria-label={labels[stage]}>
        {labels.map((label, i) => {
            const on = i <= stage;
            return (
                <li key={label} data-testid={`plan-trail-${i}`} data-on={on ? 'yes' : 'no'} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                    {i > 0 && <span aria-hidden="true" className={`absolute left-[-50%] top-[9px] h-[3px] w-full ${i <= stage ? 'bg-[#1448E6]' : 'bg-stone-200'}`} />}
                    <span className={`relative z-[1] grid h-[21px] w-[21px] place-items-center rounded-full border-2 ${on ? 'border-[#1448E6] bg-[#1448E6] text-white' : 'border-stone-300 bg-white text-transparent'}`}>
                        <Check size={12} strokeWidth={4} />
                    </span>
                    <span className={`mt-0.5 text-[12px] leading-tight ${i === stage ? 'font-extrabold text-[#1448E6]' : on ? 'font-bold text-stone-700' : 'font-semibold text-stone-500'}`}>{label}</span>
                </li>
            );
        })}
    </ol>
);

export interface PlanCardProps {
    task: LocalPlannedWork;
    today: Date;
    /** The signed-in person's user id. */
    me: string | null;
    language: string | null | undefined;
    /** The plots (or "संपूर्ण शेत") the task is on, already worded. */
    whereText: string;
    /** The assignee's name as entered, when the phone knows it (the assignee list, or himself). */
    assigneeName?: string | null;
    /** The assignee's seat (the server's role name), display only. */
    assigneeRole?: string | null;
    /** Who planned it, as entered, when the phone knows it. */
    makerName?: string | null;
    /** Lane L8c-3 - plot names for the per-plot lines of a task done on some of its plots. */
    plotNames?: ReadonlyMap<string, string>;
    parked?: ParkedStep;
    onOpenConflicts?: () => void;
    /** The assignee's buttons; omitted where there are none. */
    actions?: React.ReactNode;
}

export const PlanCard: React.FC<PlanCardProps> = ({
    task, today, me, language, whereText, assigneeName, assigneeRole, makerName, plotNames, parked, onOpenConflicts, actions,
}) => {
    const words = plannedWorkWords(language);
    const when = whenView(task, today, words, language);
    const reminder = isReminderTask(task, me);
    const stage = trailStage(task, me);
    const mine = task.assigneeUserId !== null && task.assigneeUserId === me;
    const crew = crewLine(task, words);
    const tone = when.undated ? 'amber' : when.late ? 'red' : 'blue';
    const roleWord = assigneeRole ? words.role[assigneeRole] ?? '' : '';
    const details = [task.quantityText, task.payMode ? words.payMode[task.payMode] : null, task.note].filter((x): x is string => !!x && x.length > 0);
    const trailLabels = TRAIL_STATUSES.map(s => words.status[s]);
    // Lane L8c-3: the owner's word on the logs the work was done with, and the per-plot lines of a half-done task.
    const confirmWord = task.confirmationState
        ? { Confirmed: words.confirmed, Disputed: words.disputed, Waiting: words.waitingConfirm }[task.confirmationState]
        : null;
    const isDone = task.status === 'Done';
    const partly = !isDone && task.status !== 'Cancelled' && task.plots.some(p => p.status === 'Done');
    // A plot whose name is not on the phone is "प्लॉट 1" by order - never its id (fix round 1, L006).
    const plotLines = task.plots.map((p, i) => `${plotNames?.get(p.plotId) ?? `${words.plot} ${i + 1}`} — ${p.status === 'Done' ? words.plotDone : words.plotLeft}`);

    return (
        <li data-testid={`plan-${task.id}`} data-stage={stage ?? ''} data-mine={mine ? 'yes' : 'no'} data-reminder={reminder ? 'yes' : 'no'}
            data-refused={task.refused ? 'yes' : 'no'} data-late={when.late ? 'yes' : 'no'} data-tone={tone} style={{ fontFamily: fontFor(language) }}
            className={`list-none rounded-2xl border bg-white p-3 shadow-sm ${when.late ? 'border-red-300' : 'border-stone-200'}`}>
            <div className="flex items-start justify-between gap-2">
                <h4 className="m-0 min-w-0 text-[18px] font-extrabold leading-tight text-stone-900" data-testid="plan-card-work">{workTypeNameIn(task.title, language)}</h4>
                <span data-testid="plan-card-when"
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${tone === 'amber' ? 'border-amber-400 bg-amber-50 text-amber-900' : tone === 'red' ? 'border-red-300 bg-red-50 text-red-800' : 'border-[#1448E6]/40 bg-[#1448E6]/10 text-[#1448E6]'}`}>
                    <CalendarClock size={13} aria-hidden="true" />
                    {when.main}{when.sub ? ` · ${when.sub}` : ''}
                </span>
            </div>
            {when.late && <p className="m-0 mt-1 text-[12px] font-extrabold text-red-800" data-testid="plan-card-late">{words.lateTag}</p>}
            <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] font-bold text-stone-800">
                <span className="inline-flex items-center gap-1" data-testid="plan-card-where"><MapPin size={14} className="text-emerald-700" aria-hidden="true" />{whereText}</span>
                {reminder
                    ? <span className="inline-flex items-center gap-1 text-amber-900" data-testid="plan-card-who"><Bell size={14} aria-hidden="true" />{words.reminderOnly}</span>
                    : (
                        <span className="inline-flex items-center gap-1" data-testid="plan-card-who">
                            <User size={14} className="text-stone-600" aria-hidden="true" />
                            {words.who}: {mine ? words.you : [assigneeName, roleWord].filter(Boolean).join(' · ')}
                            {mine && roleWord ? ` · ${roleWord}` : ''}
                        </span>
                    )}
            </p>
            {crew && <p className="m-0 mt-1 text-[13px] font-extrabold text-stone-800" data-testid="plan-card-crew">{crew}</p>}
            {details.length > 0 && (
                <div className="mt-1.5 space-y-0.5 rounded-xl bg-stone-50 px-2.5 py-1.5 text-[13px] font-semibold leading-snug text-stone-800" data-testid="plan-card-details">
                    {details.map((d, i) => <p key={i} className="m-0">{d}</p>)}
                </div>
            )}
            {makerName && <p className="m-0 mt-1 text-[12px] font-bold text-stone-600" data-testid="plan-card-by">{words.by}: {makerName}</p>}
            {(isDone || partly) && (confirmWord || partly) && (
                <div className="mt-1.5" data-testid="plan-card-done" data-state={task.confirmationState ?? ''} data-partly={partly ? 'yes' : 'no'}>
                    <p className={`m-0 text-[14px] font-extrabold ${task.confirmationState === 'Confirmed' ? 'text-emerald-800' : task.confirmationState === 'Disputed' ? 'text-red-800' : 'text-amber-900'}`}
                        data-testid="plan-card-confirmation">
                        {[partly ? words.partlyDone : words.status.Done, confirmWord].filter(Boolean).join(' · ')}
                    </p>
                    {partly && plotLines.length > 0 && <p className="m-0 mt-0.5 text-[13px] font-bold text-stone-800" data-testid="plan-card-plot-lines">{plotLines.join(' · ')}</p>}
                </div>
            )}
            {reminder && task.status !== 'Cancelled' && <p className="m-0 mt-1 text-[12px] font-extrabold text-amber-900" data-testid="plan-card-reminder">{words.reminder}</p>}
            {task.status === 'Cancelled' && <p className="m-0 mt-1 text-[12px] font-extrabold text-stone-600" data-testid="plan-card-cancelled">{words.status.Cancelled}</p>}
            {stage !== null && <div className="mt-2"><Trail stage={stage} labels={trailLabels} /></div>}
            {task.keptOnPhone && (
                <p className="m-0 mt-2 rounded-xl bg-sky-50 px-2.5 py-1.5 text-[13px] font-bold text-sky-900" data-testid="plan-kept" role="status">{words.keptOnPhoneLong}</p>
            )}
            {parked && (
                <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-2" data-testid="plan-parked" data-verb={parked.verb}>
                    <p className="m-0 text-[13px] font-bold text-red-900" data-testid="plan-parked-words">{parkedWords(parked, words)}</p>
                    {onOpenConflicts && (
                        <button type="button" onClick={onOpenConflicts} data-testid="plan-parked-open"
                            className="mt-1.5 min-h-[44px] rounded-full border-2 border-red-700 bg-white px-4 text-[14px] font-extrabold text-red-800 active:scale-95">{words.parkedOpen}</button>
                    )}
                </div>
            )}
            {actions && <div className="mt-2.5 flex flex-wrap gap-2 empty:hidden">{actions}</div>}
        </li>
    );
};

export default PlanCard;
