import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';

/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; doctrine P9, P10) - the three changes of a plot-season's
 * OWN schedule, queued like every other change so they work with no internet. CLIENT COMMANDS + OUTBOX ONLY: no screen in this slice (the maker is slice 4).
 *
 *   - `save`: one work, written WHOLE in the one task format. Its `taskKey` names it: a second save of the same key is an EDIT. Every save is its OWN request
 *     (a fresh id each time), so a second edit made before the first was sent is QUEUED behind it, never refused or merged away: the server applies them in
 *     order and keeps every revision (P3). Two phones saving one key make one work on the server.
 *   - `remove`: takes the work out (the server keeps its row and history).
 *   - `makeMain`: "हेच मुख्य करा", the only act that makes the own schedule main. `stageLine` (optional after the first time) is listed in DAY ORDER; a work's
 *     `stageIndex` names a stage by its place in that order.
 *
 *   - `take` (slice 9): ONE tap puts a work of a schedule the plot FOLLOWS into the own schedule, origin kept (`schedule.take_task`). It names the version it
 *     comes from, the work's key and - when the work has several doses - the one picked. The server writes the own work and its origin and NOTHING else (no plan,
 *     the main schedule untouched): "plan", then who, is the second act (`planOwnWork`). Taking it back is `remove` (the origin stays on the server).
 *
 * The queue checks each payload against the contract's own Zod schema before it is queued (a payload the server would refuse by shape never leaves the phone:
 * it throws here). The server refuses all three for a farm the schedule mechanism is not switched on for (`ShramSafal.ScheduleMechanismOff`); that refusal,
 * like every other, parks visibly with plain words (RejectionPolicy, ConflictResolutionService): nothing waiting on the phone is dropped silently.
 */

export interface OwnSchedulePlace {
    farmId: string;
    plotId: string;
    cropCycleId: string;
}

export interface OwnScheduleStageLineItem {
    name: string;
    /** Stored day (shown day - 1). */
    startDay: number;
    /** Stored day; for a stage that ends on a sign, the EXPECTED end. */
    endDay: number;
    startSign?: string;
    endSign?: string;
}

export interface QueuedOwnScheduleChange {
    clientRequestId: string;
}

/** The queue key of one change: its kind, its season, its key and a fresh id, so every change is its own request (two edits are two requests). */
const requestIdFor = (kind: string, cropCycleId: string, key: string): string => `${kind}:${cropCycleId}:${key}:${idGenerator.generate()}`;

export class OwnScheduleCommands {
    static async save(place: OwnSchedulePlace, task: ScheduleTaskContent): Promise<QueuedOwnScheduleChange> {
        const clientRequestId = requestIdFor(SyncMutationName.OwnscheduleItemSave, place.cropCycleId, task.taskKey);
        await mutationQueue.enqueue(
            SyncMutationName.OwnscheduleItemSave,
            { farmId: place.farmId, plotId: place.plotId, cropCycleId: place.cropCycleId, task },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId };
    }

    static async remove(place: OwnSchedulePlace, taskKey: string): Promise<QueuedOwnScheduleChange> {
        const clientRequestId = requestIdFor(SyncMutationName.OwnscheduleItemRemove, place.cropCycleId, taskKey);
        await mutationQueue.enqueue(
            SyncMutationName.OwnscheduleItemRemove,
            { farmId: place.farmId, plotId: place.plotId, cropCycleId: place.cropCycleId, taskKey },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId };
    }

    /** Slice 9: "माझ्या वेळापत्रकात घ्या". Offline first: one `schedule.take_task` in the outbox; the server composes the work from the version, so none of its words travel. */
    static async take(place: OwnSchedulePlace, source: { sourceVersionId: string; taskKey: string; dose?: string | null }): Promise<QueuedOwnScheduleChange> {
        const clientRequestId = requestIdFor(SyncMutationName.ScheduleTakeTask, place.cropCycleId, source.taskKey);
        const dose = source.dose?.trim();
        await mutationQueue.enqueue(
            SyncMutationName.ScheduleTakeTask,
            {
                farmId: place.farmId,
                plotId: place.plotId,
                cropCycleId: place.cropCycleId,
                sourceVersionId: source.sourceVersionId,
                taskKey: source.taskKey,
                ...(dose ? { dose } : {}),
            },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId };
    }

    static async makeMain(place: OwnSchedulePlace, options: { name?: string; stageLine?: OwnScheduleStageLineItem[] } = {}): Promise<QueuedOwnScheduleChange> {
        const clientRequestId = requestIdFor(SyncMutationName.OwnscheduleMakeMain, place.cropCycleId, 'main');
        const name = options.name?.trim();
        await mutationQueue.enqueue(
            SyncMutationName.OwnscheduleMakeMain,
            {
                farmId: place.farmId,
                plotId: place.plotId,
                cropCycleId: place.cropCycleId,
                ...(name ? { name } : {}),
                ...(options.stageLine && options.stageLine.length > 0 ? { stageLine: options.stageLine } : {}),
            },
            { clientRequestId, clientCommandId: clientRequestId },
        );
        return { clientRequestId };
    }
}
