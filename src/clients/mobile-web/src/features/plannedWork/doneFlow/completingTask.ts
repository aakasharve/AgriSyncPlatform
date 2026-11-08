/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3; founder D-24d, D-30, CTX-1, TAP-1) - the task a log is being made FOR.
 *
 * "काम झालं" on a handed-out task opens the normal recording on the task's crop and plot(s) and keeps this reference with the
 * router (`AppRouterContext.completingTask`). The reference holds ONLY which task and which plots: the log draft gets no quantity,
 * crew, headcount or pay from the plan (those words stay on the task, D-24a / P4). After the log is saved, `TaskDoneHost` asks
 * "कोणत्या प्लॉटवर झालं?" and "पूर्ण झालं / काही बाकी आहे" and sends ONE `plannedwork.complete` carrying the saved log ids.
 */
import type { CropProfile, DailyLog } from '../../../types';

export interface CompletingTask {
    plannedWorkId: string;
    farmId: string;
    /** The task's own words, for the question shown after the save. */
    title: string;
    /** The task's plots (empty for work on the whole farm or with no place fixed). */
    plotIds: string[];
    /** `lastSavedLogIds[0]` when the recording was opened: a different first id afterwards is a NEW save for this task. */
    savedAtStart: string | null;
    /** When the door was tapped (ISO). Only a log made AFTER this is the recording made for the task (fix round 1, L001). */
    openedAtISO: string;
}

/**
 * Fix round 1 (L001): the ONE rule that bounds the task reference to its visit. The reference lives in the router and is held only
 * while the person is still where the door put him: on the home tabs (route `main`), on the log view, on the farm the door was tapped
 * on. The bottom bar, any other screen, a farm switch, all end it - the router drops it then (and a different person signing in
 * drops it too). One rule here instead of a clear in every caller that can leave the recorder.
 */
export function taskReferenceHolds(
    task: CompletingTask | null,
    where: { route: string; mainView: string; farmId: string | null },
): boolean {
    return task !== null && where.route === 'main' && where.mainView === 'log' && where.farmId !== null && where.farmId === task.farmId;
}

/**
 * Fix round 1 (L001): of the logs just saved, the ones that are the recording made for the task - created after the door was tapped.
 * A change saved to an OLDER entry (the "बदला" correction, a spoken fix) is not it. A log this phone cannot read yet, or one with no
 * creation stamp, is taken as new: the save writes the history first, so that is only a gap, never a reason to refuse him.
 */
export function savedForTask(
    task: CompletingTask,
    savedIds: readonly string[],
    history: ReadonlyArray<{ id: string; meta?: { createdAtISO?: string } | null }>,
): string[] {
    const opened = Date.parse(task.openedAtISO);
    return savedIds.filter(id => {
        const made = history.find(l => l.id === id)?.meta?.createdAtISO;
        const at = made ? Date.parse(made) : NaN;
        return Number.isNaN(at) || Number.isNaN(opened) || at >= opened;
    });
}

/** The crop -> plot targets the log flow opens on, for the plots a task names (plots no crop holds are left out). */
export function plotTargets(crops: readonly CropProfile[], plotIds: readonly string[]): Array<{ cropId: string; plotId: string }> {
    const targets: Array<{ cropId: string; plotId: string }> = [];
    for (const plotId of plotIds) {
        const crop = crops.find(c => c.plots.some(p => p.id === plotId));
        if (crop) targets.push({ cropId: crop.id, plotId });
    }
    return targets;
}

/** The plots a saved log is on, from its own context. Empty when the log carries none (a whole-farm log). */
export function logPlotIds(log: Pick<DailyLog, 'context'> | undefined): string[] {
    if (!log) return [];
    const ids = (log.context?.selection ?? []).flatMap(s => s.selectedPlotIds ?? []);
    return [...new Set(ids)];
}
