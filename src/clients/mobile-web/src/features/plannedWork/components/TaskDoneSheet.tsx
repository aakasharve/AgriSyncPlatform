/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3; founder D-24d, D-30, CTX-1, TAP-1, P10) - the question after the
 * recording made for a task. "काम झालं" on his card opened the normal recording on the task's plot(s) and kept the task with the
 * router (`completingTask`). When the save lands (a NEW first saved log id; the recorder is no longer busy - the status after a save
 * is `success` for a direct save and `idle` after "confirm the draft", so the ids are the signal, not the status):
 *   - a task on several plots asks "कोणत्या प्लॉटवर झालं?" with THE crop -> plot selector (CropSelector, CTX-1), preselected with the
 *     task's plots (limited to the plots the saved logs are on);
 *   - then "पूर्ण झालं / काही बाकी आहे";
 *   - then ONE `plannedwork.complete` is queued with the saved log ids that are on the chosen plots. The log's own create is already
 *     in the outbox ahead of it, and the push waits for it (MutationDependency).
 * "आत्ता नाही" lets the task go: the log stays saved, the task stays pending. Nothing is put in the log from the plan.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { CropProfile } from '../../../types';
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import { isRecordingPathBusy } from '../../../shared/utils/recordingPathBusy';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import CropSelector from '../../context/components/CropSelector';
import { STEPPER_LABELS } from '../../logs/components/entry/entryWords';
import { PlannedWorkCommands } from '../data/plannedWorkCommands';
import { logPlotIds, savedForTask, type CompletingTask } from '../doneFlow/completingTask';
import { plannedWorkWords } from '../plannedWorkWords';
import { fontFor } from './PlanCard';

type HostCtx = Pick<AppRouterContext, 'completingTask' | 'setCompletingTask' | 'status' | 'lastSavedLogIds' | 'history' | 'crops'>;

/** The crops reduced to the plots offered, so the selector can only choose among them. */
function onlyPlots(crops: readonly CropProfile[], plotIds: readonly string[]): CropProfile[] {
    return crops
        .map(c => ({ ...c, plots: c.plots.filter(p => plotIds.includes(p.id)) }))
        .filter(c => c.plots.length > 0);
}

export const TaskDoneHost: React.FC<{ ctx: HostCtx; language?: string | null }> = ({ ctx, language: languageProp }) => {
    const task = ctx.completingTask ?? null;
    const saved = ctx.lastSavedLogIds ?? [];
    // Only a recording made AFTER the door was tapped is the task's (fix round 1, L001): a change saved to an older entry is not.
    const made = task ? savedForTask(task, saved, ctx.history ?? []) : [];
    const justSaved = task !== null && saved.length > 0 && saved[0] !== task.savedAtStart && made.length > 0
        && !isRecordingPathBusy(ctx.status) && ctx.status !== 'confirming';
    if (!task || !justSaved) return null;
    return <TaskDoneSheet key={`${task.plannedWorkId}:${made[0]}`} task={task} logIds={made} ctx={ctx} language={languageProp} />;
};

const TaskDoneSheet: React.FC<{ task: CompletingTask; logIds: readonly string[]; ctx: HostCtx; language?: string | null }> = ({
    task, logIds, ctx, language: languageProp,
}) => {
    const contextLanguage = useOptionalLanguage()?.language;
    const language = languageProp ?? contextLanguage;
    const words = plannedWorkWords(language);

    // Which plots each saved log is on (from the log itself); a log this phone cannot read here is taken to be on the task's plots.
    const logPlots = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const id of logIds) {
            const plots = logPlotIds((ctx.history ?? []).find(l => l.id === id));
            map.set(id, plots.length > 0 ? plots : task.plotIds);
        }
        return map;
    }, [ctx.history, logIds, task.plotIds]);

    const offered = useMemo(() => {
        const onLogs = new Set([...logPlots.values()].flat());
        const both = task.plotIds.filter(p => onLogs.has(p));
        return both.length > 0 ? both : task.plotIds;
    }, [logPlots, task.plotIds]);

    const offeredCrops = useMemo(() => onlyPlots(ctx.crops, offered), [ctx.crops, offered]);
    const [cropIds, setCropIds] = useState<string[]>(() => offeredCrops.map(c => c.id));
    const [plotsByCrop, setPlotsByCrop] = useState<Record<string, string[]>>(() =>
        Object.fromEntries(offeredCrops.map(c => [c.id, c.plots.map(p => p.id)])));
    const [step, setStep] = useState<'crop' | 'plot'>('plot');
    const [sending, setSending] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => { setFailed(false); }, [cropIds, plotsByCrop]);

    const chosen = [...new Set(Object.values(plotsByCrop).flat())];
    const choosing = task.plotIds.length > 1;
    const plotIds = task.plotIds.length === 0 ? [] : choosing ? chosen : offered;
    const logsOnChosen = plotIds.length === 0
        ? [...logIds]
        : logIds.filter(id => (logPlots.get(id) ?? []).some(p => plotIds.includes(p)));
    const canSend = !sending && (task.plotIds.length === 0 || plotIds.length > 0) && logsOnChosen.length > 0;

    const finish = async (somethingLeft: boolean) => {
        if (!canSend) return;
        setSending(true);
        try {
            await PlannedWorkCommands.complete({
                plannedWorkId: task.plannedWorkId,
                farmId: task.farmId,
                plotIds,
                dailyLogIds: logsOnChosen,
                somethingLeft,
            });
            ctx.setCompletingTask?.(null);
        } catch {
            setFailed(true);
            setSending(false);
        }
    };

    return (
        <div role="dialog" aria-modal="true" data-testid="task-done-sheet" style={{ fontFamily: fontFor(language) }}
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[85vh] overflow-y-auto rounded-t-3xl border-t-2 border-[#1448E6] bg-white p-4 shadow-2xl">
            <p className="m-0 text-[13px] font-bold text-stone-600" data-testid="task-done-title">{task.title}</p>
            {choosing && (
                <div className="mt-2" data-testid="task-done-plots">
                    <h4 className="m-0 mb-2 text-[18px] font-extrabold text-stone-900">{words.whichPlot}</h4>
                    {/* THE crop -> plot selector (rule CTX-1), preselected with the task's plots. */}
                    <CropSelector
                        mode="log" layout="stepper" crops={offeredCrops}
                        selectedCrops={cropIds} selectedPlots={plotsByCrop}
                        onSelectionChange={(newCrops, newPlots) => { setCropIds(newCrops); setPlotsByCrop(newPlots); }}
                        stepper={{ step, onStepChange: setStep, labels: STEPPER_LABELS }}
                    />
                    {chosen.length === 0 && <p className="m-0 mt-1 text-[12px] font-semibold text-stone-600" data-testid="task-done-hint">{words.noWhere}</p>}
                </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!canSend} onClick={() => { void finish(false); }} data-testid="task-done-all"
                    className="min-h-[52px] flex-1 rounded-full bg-[#1448E6] px-5 text-[16px] font-extrabold text-white disabled:opacity-40 active:scale-95">{words.allDone}</button>
                <button type="button" disabled={!canSend} onClick={() => { void finish(true); }} data-testid="task-done-left"
                    className="min-h-[52px] flex-1 rounded-full border-2 border-[#1448E6] bg-white px-5 text-[16px] font-extrabold text-[#1448E6] disabled:opacity-40 active:scale-95">{words.somethingLeft}</button>
            </div>
            <button type="button" onClick={() => ctx.setCompletingTask?.(null)} data-testid="task-done-notnow"
                className="mt-2 min-h-[44px] w-full rounded-full px-4 text-[14px] font-bold text-stone-700 active:scale-95">{words.notNow}</button>
            {failed && <p className="m-0 mt-1 text-[13px] font-bold text-red-800" role="alert" data-testid="task-done-failed">{words.sendFailed}</p>}
        </div>
    );
};

export default TaskDoneHost;
