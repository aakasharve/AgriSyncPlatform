/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-1, D-29, D-78 = 1, P10) - ONE task list for every screen.
 *
 * In the real app the list is what the server keeps (`plannedWork`, via `usePlannedWork`) with this phone's unanswered changes over it,
 * seen as `PlannedTask`s (`plannedWorkAsTasks`); and every change goes to the server through the queued commands:
 *   - "आठवण जोडा" / the task sheet  -> `plannedwork.create`, his own reminder (no assignee), typed;
 *   - "झाले" on a reminder          -> `plannedwork.complete` with NO log (D-1);
 *   - "वेळ बदला"                    -> `plannedwork.edit` (when);
 *   - a cancelled task              -> `plannedwork.cancel`.
 * In demo mode the old in-memory list stays as it was (demo data is never sent to a server).
 *
 * An un-tick of a finished task is not offered (P3: the owner reopens work, with his reason); such a call changes nothing.
 */
import { useCallback, useMemo } from 'react';
import type { PlannedTask } from '../../../types';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { PlannedWorkCommands, type PlannedWorkWordsInput } from './plannedWorkCommands';
import { PLANNED_WORK_CHANGED_EVENT } from './spokenMirror';
import type { LocalPlannedWork } from './plannedWorkStore';
import { usePlannedWork } from './usePlannedWork';
import { FARM_GLOBAL, plannedWorkAsTasks, isTickableHere } from './plannedWorkAsTasks';

export interface OneTaskListArgs {
    farmId: string | null;
    userId: string | null;
    isDemoMode: boolean;
    /** The plot ids of the farm on screen: a typed reminder names a plot only if it is one of these. */
    knownPlotIds: ReadonlySet<string>;
    /** Demo mode only: the old in-memory list and its two changes. */
    demo: { tasks: PlannedTask[]; save: (task: PlannedTask) => void; update: (id: string, updates: Partial<PlannedTask>) => void };
}

export interface OneTaskList {
    tasks: PlannedTask[];
    save: (task: PlannedTask) => void;
    update: (id: string, updates: Partial<PlannedTask>) => void;
}

const day = (value: string | undefined | null): string | undefined => (value ? value.slice(0, 10) : undefined);

/** The words of a stored task as an edit sends them (a full replace), with the new day laid over. */
function wordsOf(task: LocalPlannedWork, changes: { title?: string; plannedDate?: string | null }): PlannedWorkWordsInput {
    const plannedDate = 'plannedDate' in changes ? (changes.plannedDate ?? undefined) : task.plannedDate ?? undefined;
    return {
        title: changes.title ?? task.title,
        scope: task.scope,
        plotIds: task.plotIds,
        plannedDate,
        // a date and a loose word never travel together
        looseWhen: plannedDate ? undefined : task.looseWhen ?? undefined,
        plannedTime: plannedDate ? task.plannedTime ?? undefined : undefined,
        assigneeUserId: task.assigneeUserId ?? undefined,
        crewText: task.crewText ?? undefined,
        expectedHeadcount: task.expectedHeadcount ?? undefined,
        quantityText: task.quantityText ?? undefined,
        payMode: task.payMode ?? undefined,
        note: task.note ?? undefined,
    };
}

const warn = (action: string, error: unknown): void => {
    console.warn(JSON.stringify({ component: 'useOneTaskList', action, message: error instanceof Error ? error.message : String(error) }));
};

export function useOneTaskList({ farmId, userId, isDemoMode, knownPlotIds, demo }: OneTaskListArgs): OneTaskList {
    const { items, reload } = usePlannedWork(isDemoMode ? null : farmId);
    const tasks = useMemo(() => (isDemoMode ? demo.tasks : plannedWorkAsTasks(items, userId)), [isDemoMode, demo.tasks, items, userId]);

    const changed = useCallback(async () => {
        await reload();
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLANNED_WORK_CHANGED_EVENT));
    }, [reload]);

    const save = useCallback((task: PlannedTask) => {
        if (isDemoMode) { demo.save(task); return; }
        if (!farmId) return;
        void (async () => {
            try {
                // A task the store holds is changed through `update`, never made twice.
                if (items.some(i => i.id === task.id)) return;
                const plot = task.plotId && knownPlotIds.has(task.plotId) ? task.plotId : null;
                const scope = plot ? 'Plot' as const : task.plotId === FARM_GLOBAL ? 'Farm' as const : 'Unspecified' as const;
                await PlannedWorkCommands.create({
                    plannedWorkId: task.id,
                    farmId,
                    title: task.title.trim().slice(0, 200),
                    scope,
                    plotIds: plot ? [plot] : [],
                    plannedDate: day(task.dueDate),
                    sourceKind: 'Typed',
                    recordedOn: getDateKey(),
                });
                await changed();
            } catch (error) {
                warn('create_failed', error);
            }
        })();
    }, [isDemoMode, demo, farmId, items, knownPlotIds, changed]);

    const update = useCallback((id: string, updates: Partial<PlannedTask>) => {
        if (isDemoMode) { demo.update(id, updates); return; }
        if (!farmId) return;
        const task = items.find(i => i.id === id);
        if (!task || task.refused) return;
        void (async () => {
            try {
                const open = task.status !== 'Done' && task.status !== 'Cancelled';
                const movedDay = 'dueDate' in updates && day(updates.dueDate) !== (task.plannedDate ?? undefined);
                const retitled = typeof updates.title === 'string' && updates.title.trim() !== '' && updates.title.trim() !== task.title;
                if (updates.status === 'done' && open) {
                    // D-1: his own reminder is done with no log. Handed-out work needs the log (L8c-3): not here.
                    if (!isTickableHere(task, userId)) return;
                    const pending = task.plots.filter(p => p.status === 'Pending').map(p => p.plotId);
                    await PlannedWorkCommands.complete({ plannedWorkId: id, farmId, plotIds: task.plots.length > 0 ? pending : [], dailyLogIds: [], somethingLeft: false });
                } else if (updates.status === 'cancelled' && open) {
                    // The only door that cancels from a list is "काढा" (one tap removes a reminder): the reason says so, history kept (P3).
                    await PlannedWorkCommands.cancel(id, farmId, 'Removed');
                } else if (open && (movedDay || retitled)) {
                    await PlannedWorkCommands.edit({
                        plannedWorkId: id,
                        farmId,
                        ...wordsOf(task, {
                            title: retitled ? updates.title!.trim().slice(0, 200) : undefined,
                            ...(movedDay ? { plannedDate: day(updates.dueDate) ?? null } : {}),
                        }),
                    });
                } else {
                    return;
                }
                await changed();
            } catch (error) {
                warn('change_failed', error);
            }
        })();
    }, [isDemoMode, demo, farmId, items, userId, changed]);

    return { tasks, save, update };
}
