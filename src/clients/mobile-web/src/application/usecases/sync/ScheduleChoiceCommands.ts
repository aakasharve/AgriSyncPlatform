import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32). The wire twins of
// sync-contract/schemas/payloads/adopt_schedule.zod.ts and migrate_schedule.zod.ts. The server takes the actor from the
// token and ignores `actorUserId` / `actorRole` (kept because the 0.9.0 contract requires them).

export interface AdoptSchedulePayload {
    farmId: string;
    plotId: string;
    cropCycleId: string;
    scheduleTemplateId: string;
    actorUserId: string;
    /** The subscription's id, made on the phone, so the server's row comes back under the id this phone already holds. */
    subscriptionId: string;
    /** YYYY-MM-DD - the plot's day 0 set in "शेड्यूल बदला"; absent = the crop season's start. */
    referenceDate?: string;
    /** When the farmer chose (ISO, with offset) - an offline change is judged by when it was made (D-73). */
    decidedAtUtc: string;
    /**
     * spec: plr-d10 lane L8b-1F (R7) - true only on the ONE-TIME upload of a choice this phone already held: the server accepts it
     * whether or not a checked schedule exists, and marks it not checked unless it is. Absent on every new choice (and on 1.0.17).
     */
    carryOver?: true;
}

export interface MigrateSchedulePayload {
    farmId: string;
    plotId: string;
    cropCycleId: string;
    newScheduleTemplateId: string;
    /** Always `Other`, with no text: the screen asks no reason (P8). */
    reason: 'Other';
    actorUserId: string;
    newSubscriptionId: string;
    /**
     * B006: the subscription this phone believed was the plot's Active one. If the server's Active one is another, the switch is
     * refused (`ShramSafal.ScheduleChangedElsewhere`) and nothing is overwritten.
     */
    fromSubscriptionId: string;
    referenceDate?: string;
    decidedAtUtc: string;
}

/**
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - let one followed schedule go. `subscriptionId` says WHICH (a plot may follow up
 * to 3 outside schedules and 1 of his own); the server answers `ScheduleChoiceNeeded` for none when several are followed.
 */
export interface AbandonSchedulePayload {
    farmId: string;
    plotId: string;
    cropCycleId: string;
    actorUserId: string;
    subscriptionId: string;
    decidedAtUtc: string;
}

export class AdoptScheduleCommand {
    /** The queue row's id is derived from the subscription, so queuing the same choice twice is one mutation. */
    static requestIdFor(subscriptionId: string): string {
        return `${SyncMutationName.AdoptSchedule}:${subscriptionId}`;
    }

    static async enqueue(payload: AdoptSchedulePayload, options?: { clientRequestId?: string }): Promise<string> {
        const clientRequestId = options?.clientRequestId ?? AdoptScheduleCommand.requestIdFor(payload.subscriptionId);
        return mutationQueue.enqueue(SyncMutationName.AdoptSchedule, payload, { clientRequestId, clientCommandId: clientRequestId });
    }
}

export class AbandonScheduleCommand {
    /** The queue row's id is derived from the subscription let go, so letting the same one go twice is one mutation. */
    static requestIdFor(subscriptionId: string): string {
        return `${SyncMutationName.AbandonSchedule}:${subscriptionId}`;
    }

    static async enqueue(payload: AbandonSchedulePayload): Promise<string> {
        const clientRequestId = AbandonScheduleCommand.requestIdFor(payload.subscriptionId);
        return mutationQueue.enqueue(SyncMutationName.AbandonSchedule, payload, { clientRequestId, clientCommandId: clientRequestId });
    }
}

export class MigrateScheduleCommand {
    static requestIdFor(subscriptionId: string): string {
        return `${SyncMutationName.MigrateSchedule}:${subscriptionId}`;
    }

    static async enqueue(payload: MigrateSchedulePayload): Promise<string> {
        const clientRequestId = MigrateScheduleCommand.requestIdFor(payload.newSubscriptionId);
        return mutationQueue.enqueue(SyncMutationName.MigrateSchedule, payload, { clientRequestId, clientCommandId: clientRequestId });
    }
}
