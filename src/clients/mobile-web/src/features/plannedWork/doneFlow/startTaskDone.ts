/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3; founder D-24d, CTX-1) - "काम झालं" on a handed-out task: open the
 * normal recording on the task's crop and plot(s) through the ONE door (`openLogFlow`), keeping the task reference with the router.
 * A recording already waiting is not touched (the door's rule): nothing is moved and no task is attached to it.
 */
import type { AppRouterContext } from '../../../core/navigation/routeContext';
import { openLogFlow, type LogFlowOpened } from '../../../core/navigation/openLogFlow';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { plotTargets } from './completingTask';

type DoneCtx = Pick<
    AppRouterContext,
    'crops' | 'lastSavedLogIds' | 'status' | 'draftLog' | 'handleReset' | 'setLogScope' | 'setMode' | 'setMainView' | 'setCurrentRoute' | 'setCompletingTask'
>;

export function startTaskDone(ctx: DoneCtx, task: LocalPlannedWork): LogFlowOpened {
    const targets = plotTargets(ctx.crops, task.plotIds);
    const opened = openLogFlow(ctx, targets.length > 0 ? targets : undefined, {
        plannedWorkId: task.id,
        farmId: task.farmId,
        title: task.title,
        plotIds: task.plotIds,
        savedAtStart: ctx.lastSavedLogIds?.[0] ?? null,
        openedAtISO: new Date().toISOString(),
    });
    // The recording lives on the home tabs; the plan page was a route over them. A recording that was already waiting is not this
    // task's: he stays here, told to finish it first (the page says so), instead of being dropped onto an unrelated screen.
    if (opened === 'opened') ctx.setCurrentRoute('main');
    return opened;
}
