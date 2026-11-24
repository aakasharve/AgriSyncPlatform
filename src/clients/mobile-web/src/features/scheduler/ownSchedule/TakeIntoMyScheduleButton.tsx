/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 2 and
 * its guardrail; SM-10; P2, P10) - the ONE button "माझ्या वेळापत्रकात घ्या" on a work card of a schedule the plot follows.
 *
 * STANDALONE: it takes the work (its key, its words) and the version it comes from, so the day-card renderer (slice 8) can host it on its card exactly as the
 * schedule page's work card does now. It draws nothing else of the card.
 *   1. take (one tap; a pick-one-dose sheet first when the work states several doses that differ) - queues ONE `schedule.take_task`, offline first;
 *   2. then "नियोजन करा" and who - the existing plan door (`planOwnWork`: `ownschedule.item.plan`). Take alone makes NO plan and changes no main schedule; the
 *      three taps (take, plan, who) are the three acts. The plan can wait in the outbox behind the take (they are sent in order);
 *   3. "परत काढा" takes it back out (the existing removal; the origin stays on the server).
 * A take the server refused says why in words and opens the conflict page. Shown only from today onward (`offersTake`), and only for a seat that may take (the
 * server decides every request: the farm's owner or a seat holding the schedule and the planning permission).
 */
import React, { useState } from 'react';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { OwnScheduleCommands, type OwnSchedulePlace } from '../../../application/usecases/sync/OwnScheduleCommands';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { Tap } from '../../../shared/components/ui/placeUi';
import { PlanAssigneeChips, type AssigneeChoice } from '../../plannedWork/components/PlanAssigneeChips';
import { usePlannedWork } from '../../plannedWork/data/usePlannedWork';
import type { OwnWorkPlanning } from './OwnWorkList';
import type { OwnLanguage } from './ownScheduleWords';
import { ownItemIdFor, planOwnWork, planStateOf } from './ownWorkPlan';
import { OWN_WORK_PLAN_WORDS, refusalWords } from './ownWorkPlanWords';
import { doseChoicesOf, needsDosePick, offersTake, useTakeState } from './takeIntoMySchedule';
import { TAKE_WORDS, takeRefusalWords } from './takeWords';

export interface TakeIntoMyScheduleButtonProps {
    place: OwnSchedulePlace;
    /** The version of the followed schedule this card comes from. */
    sourceVersionId: string;
    /** The work as the card shows it (its key and its doses decide the rest). */
    task: ScheduleTaskContent;
    language: OwnLanguage;
    /** The card's day and today's day on the plot, both stored days: a card of a past day offers no take. Unknown = offered. */
    dayStored?: number | null;
    todayStored?: number | null;
    /** False for a seat that may not take (it is hidden, never greyed). The server decides every request. */
    mayTake?: boolean;
    /** Given for a seat that may plan: the second and third taps (plan, who). Absent = the card stops at "in my schedule". */
    planning?: OwnWorkPlanning;
    onOpenConflicts?: () => void;
}

export const TakeIntoMyScheduleButton: React.FC<TakeIntoMyScheduleButtonProps> = ({
    place, sourceVersionId, task, language, dayStored, todayStored, mayTake = true, planning, onOpenConflicts,
}) => {
    const words = TAKE_WORDS[language];
    const planWords = OWN_WORK_PLAN_WORDS[language];
    const key = task.taskKey;
    const state = useTakeState(place.cropCycleId, key);
    const { items: plans } = usePlannedWork(planning ? place.farmId : null);
    const [picking, setPicking] = useState(false);
    const [choosing, setChoosing] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!mayTake || state === null || !offersTake(dayStored, todayStored)) return null;

    const send = async (action: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            backgroundSyncWorker.triggerNow().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    };
    const take = (dose: string | null) => send(async () => {
        setPicking(false);
        await OwnScheduleCommands.take(place, { sourceVersionId, taskKey: key, dose });
    });

    if (state.kind === 'none' || state.kind === 'refused') {
        return (
            <div className="mt-1.5 space-y-1.5" data-testid={`take-${key}`} data-take-state={state.kind}>
                {state.kind === 'refused' && (
                    <p className="m-0 text-[13px] font-bold text-rose-800" data-testid={`take-refused-${key}`}>
                        {takeRefusalWords(words, state.code, state.message)}{' '}
                        {onOpenConflicts && <button type="button" onClick={onOpenConflicts} className="min-h-[44px] font-extrabold underline underline-offset-2">{words.openConflicts}</button>}
                    </p>
                )}
                {picking ? (
                    <div className="space-y-1.5 rounded-2xl bg-sky-50 p-2.5 ring-1 ring-sky-200" data-testid={`take-dose-${key}`}>
                        <b className="block text-[15px] font-extrabold text-stone-900">{words.pickDose}</b>
                        {doseChoicesOf(task).map((dose, i) => (
                            <Tap key={dose} onClick={() => { void take(dose); }} disabled={busy} data-testid={`take-dose-${key}-${i}`}
                                className="flex min-h-[48px] w-full items-center rounded-xl border-2 border-sky-300 bg-white px-3 text-left text-[15px] font-extrabold text-stone-900">{dose}</Tap>
                        ))}
                        <Tap onClick={() => setPicking(false)} data-testid={`take-dose-cancel-${key}`} className="min-h-[44px] rounded-full px-3 text-[14px] font-bold text-stone-700">{words.notNow}</Tap>
                    </div>
                ) : (
                    <Tap onClick={() => { if (needsDosePick(task)) setPicking(true); else void take(null); }} disabled={busy} data-testid={`take-btn-${key}`}
                        className="min-h-[48px] rounded-full border-2 border-emerald-700 bg-white px-4 text-[15px] font-extrabold text-emerald-900">{words.take}</Tap>
                )}
            </div>
        );
    }

    // taken (the server's own work) or queued (kept on this phone): the plan door follows, never a plan by itself.
    const planState = planning ? planStateOf(plans, ownItemIdFor(place.cropCycleId, key), task.timing.repeat !== 'once') : null;
    const planIt = async (choice: AssigneeChoice, occurrence: number) => {
        if (!choice || !planning) return;
        await send(async () => {
            const assignee = choice.kind === 'person' ? choice.userId : choice.kind === 'self' ? planning.myUserId : null;
            await planOwnWork(place, key, occurrence, assignee);
            setChoosing(false);
        });
    };
    return (
        <div className="mt-1.5 space-y-1.5" data-testid={`take-${key}`} data-take-state={state.kind}>
            <p className="m-0 text-[14px] font-extrabold text-emerald-800" data-testid={`take-in-${key}`}>{state.kind === 'queued' ? words.queued : words.taken}</p>
            {planState?.kind === 'open' && (
                <p className="m-0 text-[13.5px] font-extrabold text-emerald-800" data-testid={`take-planned-${key}`}>{planState.plan.keptOnPhone ? planWords.plannedKept : planWords.planned}</p>
            )}
            {planState?.kind === 'done' && <p className="m-0 text-[13.5px] font-extrabold text-emerald-800">{planWords.done}</p>}
            {planState?.kind === 'refused' && (
                <p className="m-0 text-[13px] font-bold text-rose-800" data-testid={`take-plan-refused-${key}`}>{refusalWords(planWords, planState.plan.refusedCode)}</p>
            )}
            {planState?.kind === 'none' && !choosing && (
                <Tap onClick={() => setChoosing(true)} data-testid={`take-plan-${key}`}
                    className="min-h-[48px] rounded-full border-2 border-emerald-700 bg-white px-4 text-[15px] font-extrabold text-emerald-900">{planWords.plan}</Tap>
            )}
            {planState?.kind === 'none' && choosing && planning && (
                <div className="space-y-1.5 rounded-2xl bg-sky-50 p-2.5 ring-1 ring-sky-200" data-testid={`take-who-${key}`}>
                    <b className="block text-[15px] font-extrabold text-stone-900">{planWords.whoQ}</b>
                    <PlanAssigneeChips value={null} onChange={c => { void planIt(c, planState.nextOccurrence); }} mayAssign={planning.mayAssign}
                        assignees={planning.assignees} myUserId={planning.myUserId} language={language} />
                    <Tap onClick={() => setChoosing(false)} data-testid={`take-who-notnow-${key}`} className="min-h-[44px] rounded-full px-3 text-[14px] font-bold text-stone-700">{planWords.notNow}</Tap>
                </div>
            )}
            {state.kind === 'taken' && (planState === null || planState.kind === 'none') && (
                <Tap onClick={() => { void send(() => OwnScheduleCommands.remove(place, key)); }} disabled={busy} data-testid={`take-back-${key}`}
                    className="min-h-[44px] rounded-full px-3 text-[14px] font-extrabold text-rose-700">{words.takeBack}</Tap>
            )}
        </div>
    );
};

export default TakeIntoMyScheduleButton;
