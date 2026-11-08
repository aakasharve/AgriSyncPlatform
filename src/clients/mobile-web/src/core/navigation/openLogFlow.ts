/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, T2) — the ONE way another tab opens the
 * recorder: "झालं, सांगा" on तुलना (for that plot), "काम सांगा" on तुलना, "बोलून सांगा" in करायची कामे.
 *
 * The log flow's state (`status`, `draftLog`, the picked plot) lives ABOVE the tab boundary and survives a
 * tab switch (`shared/utils/recordingPathBusy.ts`), so a door into it must respect what it already holds:
 *
 *   - something is waiting (a parsed draft to confirm — `useVoiceRecorder` leaves it at status `idle` with
 *     `draftLog` set —, a manual edit in progress, a `confirming` screen, or the recorder busy): NOTHING is
 *     changed — the plot is not moved and nothing is cleared; the log tab opens on what is waiting, for him
 *     to finish or discard first. `handleFinalConfirm` saves under the CURRENT plot, so moving the plot under
 *     a waiting draft would file a log spoken for plot A under plot B.
 *   - a save just finished (`success`), or an `error` with no draft left: the flow is reset to a fresh
 *     recorder first — the same reset the success card's own "add another" runs (`handleReset`) — so he
 *     never lands on the old screen, and the recorder he lands on is for the plot he tapped.
 *   - otherwise: pick the plot (when one is given), voice, the log tab.
 *
 * Lane L8c-3 (founder D-24d): "काम झालं" on a task opens the same recorder on the task's crop and plot(s) (`plot` may be a list) and keeps
 * a reference to the task (`task`) with the router, so the save can be completed against it. The task brings only WHICH task and
 * WHICH plots: nothing is put into the draft (no quantity, crew, headcount or pay: D-24a). A recording already waiting gets no task.
 * Any other door (`task` absent) lets go of a task reference left from an earlier opening.
 */
import type { AppRouterContext } from './routeContext';
import type { CompletingTask } from '../../features/plannedWork/doneFlow/completingTask';
import { isRecordingPathBusy } from '../../shared/utils/recordingPathBusy';

export type LogFlowDoorCtx = Pick<AppRouterContext, 'status' | 'draftLog' | 'handleReset' | 'setLogScope' | 'setMode' | 'setMainView' | 'setCompletingTask'>;

export type LogFlowTarget = { cropId: string; plotId: string };

/** What the door did: opened a fresh recorder, or showed what was already waiting. */
export type LogFlowOpened = 'opened' | 'waiting';

export function hasWaitingLogWork(ctx: Pick<AppRouterContext, 'status' | 'draftLog'>): boolean {
    if (isRecordingPathBusy(ctx.status) || ctx.status === 'confirming') return true;
    return ctx.status !== 'success' && ctx.draftLog != null;
}

export function openLogFlow(ctx: LogFlowDoorCtx, plot?: LogFlowTarget | readonly LogFlowTarget[], task?: CompletingTask): LogFlowOpened {
    if (hasWaitingLogWork(ctx)) {
        ctx.setMainView('log');
        return 'waiting';
    }
    if (ctx.status === 'success' || ctx.status === 'error') ctx.handleReset();
    const targets: readonly LogFlowTarget[] = plot === undefined ? [] : Array.isArray(plot) ? plot : [plot as LogFlowTarget];
    if (targets.length > 0) {
        ctx.setLogScope({
            selectedCropIds: [...new Set(targets.map(t => t.cropId))],
            selectedPlotIds: targets.map(t => t.plotId),
            mode: targets.length > 1 ? 'multi' : 'single',
            applyPolicy: 'broadcast',
        });
    }
    ctx.setCompletingTask?.(task ?? null);
    ctx.setMode('voice');
    ctx.setMainView('log');
    return 'opened';
}
