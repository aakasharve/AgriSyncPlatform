/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, founder D-24c, D-24a, P4, P5) - what a card shows, decided in
 * one place. Pure.
 *   - A reminder (no assignee, or the maker himself - the server's `IsReminder`) says "आठवण", never "सोपवलं", and has no trail.
 *   - The trail सोपवलं -> पाहिलं -> स्वीकारलं -> झालं stands on the task's status; a parked step is not in the status (the store
 *     leaves it out), so a parked accept never shows as accepted.
 *   - The crew line is the crew words and the expected headcount AS WORDS ("रोकडेची टीम · १० जण"): nothing here is a हजेरी,
 *     a wage or a cost.
 */
import type { LocalPlannedWork } from './data/plannedWorkStore';
import type { PlannedWorkWords } from './plannedWorkWords';

export const TRAIL_STATUSES = ['Assigned', 'Seen', 'Accepted', 'Done'] as const;

/** The server's `IsReminder`: nobody, or the maker himself. A task made on this phone has no maker field yet: it is his. */
export function isReminderTask(task: Pick<LocalPlannedWork, 'assigneeUserId' | 'createdByUserId'>, me: string | null): boolean {
    if (!task.assigneeUserId) return true;
    const maker = task.createdByUserId ?? me;
    return maker !== null && task.assigneeUserId === maker;
}

/** 0..3 on the trail, or null where there is none (a reminder, a cancelled task). */
export function trailStage(task: Pick<LocalPlannedWork, 'status' | 'assigneeUserId' | 'createdByUserId'> & { refused?: boolean }, me: string | null): 0 | 1 | 2 | 3 | null {
    if (task.refused || isReminderTask(task, me)) return null;
    const at = TRAIL_STATUSES.indexOf(task.status as (typeof TRAIL_STATUSES)[number]);
    return at < 0 ? null : (at as 0 | 1 | 2 | 3);
}

/** The words of the crew line, or '' when the task has none. */
export function crewLine(task: Pick<LocalPlannedWork, 'crewText' | 'expectedHeadcount'>, words: PlannedWorkWords): string {
    const team = (task.crewText ?? '').trim();
    if (!team && task.expectedHeadcount === null) return '';
    return words.crewLine(team || words.crew, task.expectedHeadcount);
}

/** Open work: not done, not cancelled, and not a create the server refused (that is not work yet). */
export const isOpenTask = (task: Pick<LocalPlannedWork, 'status'> & { refused?: boolean }): boolean => !task.refused && task.status !== 'Done' && task.status !== 'Cancelled';
