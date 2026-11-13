/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4; founder D-1, D-24, D-29, D-78 = 1, P10) - ONE list. करायची कामे, लक्ष द्या
 * (its late items and its count) and the bottom-bar count all read `PlannedTask`s; this makes those out of what the server keeps
 * (`plannedWork`, with this phone's unanswered changes laid over it), so the same task is on all of them, once, and a tick on any
 * of them is a tick on the task. Pure.
 *
 *   - Only this farm's tasks (the store keeps other farms out). A create the server refused is not work (never counted or drawn as
 *     open); it stays on the plan list with its refusal words and the conflict link.
 *   - Reminders (nobody else is accountable) and work handed to ME. Work handed to someone else is the plan list's, not this person's to-do.
 *   - A task has a date or it does not: undated and loose ("या आठवड्यात / या महिन्यात / जमेल तेव्हा") work has NO due date here, so it is
 *     never late on any surface or count (Review Focus 5).
 *   - Spoken: `ai_extracted` ("बोलण्यातून"). Typed or planned: `manual`.
 *   - `listSource.tickable`: "झाले" can be said here only on a reminder he made himself (D-1: no log); work handed to him needs a log.
 */
import type { PlannedTask } from '../../../types';
import type { LocalPlannedWork } from './plannedWorkStore';
import { isReminderTask, isOpenTask } from '../planCardModel';

export const FARM_GLOBAL = 'FARM_GLOBAL';

const SOURCE_OF: Record<NonNullable<LocalPlannedWork['sourceKind']>, PlannedTask['sourceType']> = {
    Spoken: 'ai_extracted',
    Typed: 'manual',
    PlanForm: 'manual',
    Leftover: 'observation_derived',
};

/** Is this item part of the person's own list (a reminder, or work handed to him), and not a refused create? */
export function isOnMyList(task: LocalPlannedWork, me: string | null): boolean {
    if (task.refused) return false;
    return isReminderTask(task, me) || (task.assigneeUserId !== null && task.assigneeUserId === me);
}

/** May he say "झाले" on it here, with no log? His own reminder, still open. */
export function isTickableHere(task: LocalPlannedWork, me: string | null): boolean {
    if (task.refused || !isOpenTask(task) || !isReminderTask(task, me)) return false;
    const maker = task.createdByUserId ?? me;
    return maker !== null && maker === me;
}

export function toPlannedTask(task: LocalPlannedWork, me: string | null): PlannedTask {
    const plotPlace = task.scope === 'Plot' || task.scope === 'MultiPlot' ? task.plotIds[0] : undefined;
    const placed = plotPlace ?? (task.scope === 'Unspecified' ? task.sourcePlotId ?? undefined : undefined);
    return {
        id: task.id,
        title: task.title,
        description: task.note ?? undefined,
        dueDate: task.plannedDate ?? undefined,
        plotId: placed ?? FARM_GLOBAL,
        cropId: placed ? undefined : FARM_GLOBAL,
        priority: 'normal',
        status: task.status === 'Done' ? 'done' : task.status === 'Cancelled' ? 'cancelled' : 'pending',
        sourceType: task.sourceKind ? SOURCE_OF[task.sourceKind] : 'manual',
        createdAt: task.recordedOn || task.modifiedAtUtc || '',
        listSource: {
            scope: task.scope,
            tickable: isTickableHere(task, me),
            keptOnPhone: task.keptOnPhone,
            farmId: task.farmId,
            reminder: {
                category: task.category ?? categoryOfKind(task.sourceKind),
                kind: task.sourceKind,
                createdByUserId: task.createdByUserId,
                createdByName: task.createdByName ?? null,
                createdAtUtc: task.createdAtUtc ?? null,
                sourceDailyLogId: task.sourceDailyLogId ?? null,
                mayPlayVoice: task.mayPlayVoice ?? null,
                wordsWithheld: task.wordsWithheld === true,
                makerAlwaysShown: task.makerAlwaysShown === true,
                fromChosenPeopleRecord: task.fromChosenPeopleRecord === true,
            },
        },
    };
}

/** A server that did not say the category (an older one): the door's own words say it (Spoken, Leftover = records; the rest = planning). */
function categoryOfKind(kind: LocalPlannedWork['sourceKind']): 'FromPlanning' | 'FromLogs' {
    return kind === 'Spoken' || kind === 'Leftover' ? 'FromLogs' : 'FromPlanning';
}

/** The farm's one list as `PlannedTask`s, in the order the store has them. */
export function plannedWorkAsTasks(items: readonly LocalPlannedWork[], me: string | null): PlannedTask[] {
    return items.filter(t => isOnMyList(t, me)).map(t => toPlannedTask(t, me));
}
