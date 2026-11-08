/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3; founder D-24d, D-1, D-30, P10) - the two buttons of the done step.
 *   - "काम झालं" on the card of the person the work is handed to (and on a reminder of his own, which says "आठवण" and needs no log:
 *     D-1). On handed-out work it opens the normal recording on the task's plot(s) (`onStartDone`); on a reminder it sends the one
 *     `plannedwork.complete` straight away. Not drawn while a done step of this task is waiting or was refused (the card says so).
 *   - "पुन्हा उघडा" on a done task, for the PRIMARY owner only (the server decides), with a reason box: the reason is required and goes
 *     with the change.
 */
import React, { useState } from 'react';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import type { ParkedStep } from '../data/plannedWorkParked';
import { isReminderTask } from '../planCardModel';
import type { PlannedWorkWords } from '../plannedWorkWords';

export interface PlanDoneActionsProps {
    task: LocalPlannedWork;
    me: string | null;
    words: PlannedWorkWords;
    isPrimaryOwner: boolean;
    parked?: ParkedStep;
    /** Opens the recording for a handed-out task; `waiting` = a recording is already open and was not touched. */
    onStartDone?: (task: LocalPlannedWork) => 'opened' | 'waiting';
    /** Told after a step was queued, so the list re-reads. */
    onQueued: () => void;
    /** A line to show on the page (the recording that is waiting). */
    onNote: (note: string) => void;
}

const WORKING: ReadonlySet<LocalPlannedWork['status']> = new Set(['Open', 'Assigned', 'Seen', 'Accepted']);

export const PlanDoneActions: React.FC<PlanDoneActionsProps> = ({ task, me, words, isPrimaryOwner, parked, onStartDone, onQueued, onNote }) => {
    const [asking, setAsking] = useState(false);
    const [reason, setReason] = useState('');
    const [needsReason, setNeedsReason] = useState(false);
    const [busy, setBusy] = useState(false);

    const reminder = isReminderTask(task, me);
    const mine = task.assigneeUserId !== null && task.assigneeUserId === me;
    // A reminder is done by its maker; handed-out work by the person it is handed to. The server decides the same way.
    const maker = task.createdByUserId === null ? me !== null : task.createdByUserId === me;
    const mayMarkDone = !task.refused && WORKING.has(task.status) && (reminder ? maker : mine)
        && !task.pendingSteps.includes('complete') && !(parked && parked.verb === 'complete');
    const mayReopen = isPrimaryOwner && task.status === 'Done' && !task.refused
        && !task.pendingSteps.includes('reopen') && !(parked && parked.verb === 'reopen');

    const markDone = async () => {
        if (busy) return;
        if (reminder) {
            setBusy(true);
            try {
                await PlannedWorkCommands.complete({ plannedWorkId: task.id, farmId: task.farmId, plotIds: task.plotIds, dailyLogIds: [], somethingLeft: false });
                onQueued();
            } finally {
                setBusy(false);
            }
            return;
        }
        if (onStartDone?.(task) === 'waiting') onNote(words.finishWaitingFirst);
    };

    const reopen = async () => {
        if (busy) return;
        if (reason.trim().length === 0) { setNeedsReason(true); return; }
        setBusy(true);
        try {
            await PlannedWorkCommands.reopen(task.id, task.farmId, reason.trim().slice(0, 500));
            setAsking(false); setReason(''); setNeedsReason(false);
            onQueued();
        } finally {
            setBusy(false);
        }
    };

    if (!mayMarkDone && !mayReopen) return null;
    return (
        <>
            {mayMarkDone && (
                <button type="button" data-testid={`plan-done-${task.id}`} onClick={() => { void markDone(); }}
                    className="min-h-[48px] rounded-full bg-emerald-700 px-5 text-[15px] font-extrabold text-white active:scale-95">{words.markDone}</button>
            )}
            {mayReopen && !asking && (
                <button type="button" data-testid={`plan-reopen-${task.id}`} onClick={() => setAsking(true)}
                    className="min-h-[48px] rounded-full border-2 border-stone-600 bg-white px-5 text-[15px] font-extrabold text-stone-800 active:scale-95">{words.reopen}</button>
            )}
            {mayReopen && asking && (
                <div className="w-full space-y-2" data-testid={`plan-reopen-box-${task.id}`}>
                    <label className="block text-[14px] font-extrabold text-stone-800" htmlFor={`plan-reopen-reason-${task.id}`}>{words.reopenWhy}</label>
                    <textarea id={`plan-reopen-reason-${task.id}`} data-testid={`plan-reopen-reason-${task.id}`} value={reason} maxLength={500} rows={2}
                        placeholder={words.reopenReasonPh}
                        onChange={e => { setReason(e.target.value); setNeedsReason(false); }}
                        className="w-full rounded-xl border-2 border-stone-300 p-2 text-[15px] font-semibold text-stone-900" />
                    {needsReason && <p className="m-0 text-[13px] font-bold text-red-800" role="alert" data-testid={`plan-reopen-need-${task.id}`}>{words.reopenNeedsReason}</p>}
                    <div className="flex gap-2">
                        <button type="button" data-testid={`plan-reopen-send-${task.id}`} onClick={() => { void reopen(); }}
                            className="min-h-[48px] rounded-full bg-stone-800 px-5 text-[15px] font-extrabold text-white active:scale-95">{words.reopenSend}</button>
                        <button type="button" data-testid={`plan-reopen-cancel-${task.id}`} onClick={() => { setAsking(false); setNeedsReason(false); }}
                            className="min-h-[48px] rounded-full border-2 border-stone-300 bg-white px-5 text-[15px] font-extrabold text-stone-700 active:scale-95">{words.reopenCancel}</button>
                    </div>
                </div>
            )}
        </>
    );
};

export default PlanDoneActions;
