import { v5 as uuidv5 } from 'uuid';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { ScheduleSignAnswerName } from '../../../infrastructure/storage/plannedWorkRow';

/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन"; approved spec plr-d10-schedule-approved-spec-2026-11-23; P9, P10) -
 * the two changes that make the farmer's own schedule feed नियोजन, queued like every other change so they work with no internet.
 *
 *   - `plan`: "plan", then who, on ONE own work - the farmer's SECOND act (saving a work makes no plan). The plan id is the UUIDv5 of the own item and the
 *     occurrence (`schedulePlanId`), the same on every phone and on the server (`PlannedWork.ScheduleIdFor`), so two phones planning the same occurrence offline
 *     make one plan; the server also answers with an open plan of the work whatever id is sent. The server words it, dates it or makes it wait.
 *   - `answerSign`: "दिसलं / अजून नाही / खात्री नाही" about one "when seen" work. Every answer is its own request (append-only on the server).
 *
 * Unrelated work is planned with the ordinary plan form (plannedwork.create) and never enters the schedule. The queue checks each payload against the contract's
 * Zod schema before it is queued. The server refuses both for a farm the schedule mechanism is not switched on for; that refusal parks visibly (P10).
 */

/** NEVER CHANGE THIS VALUE: the server's `PlannedWork.ScheduleIdNamespace`. */
export const SCHEDULE_PLAN_NAMESPACE = '5f1c7e20-93a4-4b8d-8e65-2d0a4c9b7f31';

/** The id of occurrence `occurrence` (1 = the first) of the own work `ownItemId`: the same on every phone and on the server. */
export function schedulePlanId(ownItemId: string, occurrence: number): string {
    return uuidv5(`${ownItemId.toLowerCase()}:${occurrence}`, SCHEDULE_PLAN_NAMESPACE);
}

export interface ScheduleFeedPlace {
    farmId: string;
    plotId: string;
    cropCycleId: string;
}

export interface QueuedScheduleFeedChange {
    clientRequestId: string;
    /** The plan's id (plan) or the answer's id (answerSign). */
    id: string;
}

export class ScheduleFeedCommands {
    static async plan(
        place: ScheduleFeedPlace,
        work: { taskKey: string; ownItemId: string; occurrence: number },
        options: { assigneeUserId?: string | null; note?: string | null; recordedOn?: string } = {},
    ): Promise<QueuedScheduleFeedChange> {
        const plannedWorkId = schedulePlanId(work.ownItemId, work.occurrence);
        const clientRequestId = `${SyncMutationName.OwnscheduleItemPlan}:${plannedWorkId}`;
        const note = options.note?.trim();
        // One request per occurrence: a second tap while it waits queues nothing new; a refused one is re-armed (enqueueRepeatable).
        await mutationQueue.enqueueRepeatable(
            SyncMutationName.OwnscheduleItemPlan,
            {
                plannedWorkId,
                farmId: place.farmId,
                plotId: place.plotId,
                cropCycleId: place.cropCycleId,
                taskKey: work.taskKey,
                ...(options.assigneeUserId ? { assigneeUserId: options.assigneeUserId } : {}),
                ...(note ? { note } : {}),
                ...(options.recordedOn ? { recordedOn: options.recordedOn } : {}),
            },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId, id: plannedWorkId };
    }

    static async answerSign(
        place: ScheduleFeedPlace, taskKey: string, answer: ScheduleSignAnswerName, observedOn?: string,
    ): Promise<QueuedScheduleFeedChange> {
        const eventId = idGenerator.generate();
        const clientRequestId = `${SyncMutationName.ScheduleTaskEvent}:${eventId}`;
        await mutationQueue.enqueue(
            SyncMutationName.ScheduleTaskEvent,
            {
                eventId,
                farmId: place.farmId,
                plotId: place.plotId,
                cropCycleId: place.cropCycleId,
                taskKey,
                answer,
                ...(observedOn ? { observedOn } : {}),
            },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId, id: eventId };
    }
}
