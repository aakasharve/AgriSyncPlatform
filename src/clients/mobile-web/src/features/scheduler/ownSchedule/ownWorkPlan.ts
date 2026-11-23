/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "the plan door"; approved spec: take / save never plans by itself, "plan" then who is the SECOND
 * act; SM-10; P10) - what one work of "माझं शेड्यूल" says about its plan, and the one way the phone plans it.
 *   - the own work's id is the server's (`OwnScheduleItem.IdFor`: a UUIDv5 of the crop season and the task key), so a plan the phone queues names the same work;
 *   - ONE open occurrence at a time: an open plan of the work (the server's, or one waiting on this phone) is the answer, never a second plan button;
 *   - the occurrence the phone sends is the open plan's, else the highest one it knows plus one (the server checks and answers with the plan it keeps);
 *   - a refusal parks visibly (the conflict page) and the work says so in words.
 */
import { v5 as uuidv5 } from 'uuid';
import { ScheduleFeedCommands, type ScheduleFeedPlace } from '../../../application/usecases/sync/ScheduleFeedCommands';
import type { LocalPlannedWork } from '../../plannedWork/data/plannedWorkStore';

/** NEVER CHANGE THIS VALUE: the server's `OwnScheduleItem.IdNamespace`. */
export const OWN_ITEM_NAMESPACE = '0b6a8d52-7c3e-4f19-9a21-5e7d3c8b4f60';

/** The id of the work `taskKey` of the crop season `cropCycleId`: the same on every phone and on the server. */
export function ownItemIdFor(cropCycleId: string, taskKey: string): string {
    return uuidv5(`${cropCycleId.toLowerCase()}:${taskKey}`, OWN_ITEM_NAMESPACE);
}

export type OwnWorkPlanState =
    | { kind: 'none'; nextOccurrence: number }
    | { kind: 'open'; plan: LocalPlannedWork }
    | { kind: 'done'; plan: LocalPlannedWork }
    | { kind: 'refused'; plan: LocalPlannedWork };

/**
 * Where the plan of one own work stands on this phone. `repeats` = the work repeats (a done occurrence then offers the next one). A refused plan (parked) is
 * said until he deals with it on the conflict page; a cancelled one lets him plan again.
 */
export function planStateOf(plans: readonly LocalPlannedWork[], ownItemId: string, repeats: boolean): OwnWorkPlanState {
    const mine = plans.filter(p => p.ownItemId === ownItemId);
    const refused = mine.find(p => p.refused);
    if (refused) return { kind: 'refused', plan: refused };
    const open = mine.find(p => p.status !== 'Done' && p.status !== 'Cancelled');
    if (open) return { kind: 'open', plan: open };
    const done = mine.find(p => p.status === 'Done');
    const highest = mine.reduce((max, p) => Math.max(max, p.occurrence ?? 0), 0);
    if (done && !repeats) return { kind: 'done', plan: done };
    return { kind: 'none', nextOccurrence: highest + 1 };
}

/**
 * "plan", then who: queues ONE `ownschedule.item.plan` (offline first). `assigneeUserId` null = a reminder for himself. Tells the plan lists to read again at
 * once, so the plan shows straight away as kept on this phone.
 */
export async function planOwnWork(
    place: ScheduleFeedPlace, taskKey: string, occurrence: number, assigneeUserId: string | null,
): Promise<string> {
    const queued = await ScheduleFeedCommands.plan(
        place, { taskKey, ownItemId: ownItemIdFor(place.cropCycleId, taskKey), occurrence }, { assigneeUserId },
    );
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('agrisync:planned-work-changed'));
    return queued.id;
}
