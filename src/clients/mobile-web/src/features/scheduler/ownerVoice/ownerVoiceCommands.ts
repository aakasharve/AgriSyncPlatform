// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; P10) - the three things a farm does about the owner's voice, queued like every other change so they work with no
// signal and replay ONCE. The payloads are exactly the contract's (checked by the queue against the Zod schemas before they are queued).
//   - heard: the first FULL play of a message on a plot. Its request id is the plot and the message, so a second play queues nothing more (the server keeps the first too).
//   - decide: accept / keep_old / take_back. Every decision is its own request (a later decision never edits an earlier one: the highest sequence stands).
//   - answer: one of a look's two answers. Its request id is the plot and the message (the first answer is kept).
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { OwnerAnswer, OwnerDecision } from './ownerVoiceTypes';

export interface OwnerPlace { farmId: string; plotId: string; cropCycleId: string }

export class OwnerVoiceCommands {
    static async heard(place: { farmId: string; plotId: string }, messageId: string): Promise<void> {
        const id = `ownermsg.heard:${place.plotId}:${messageId}`;
        await mutationQueue.enqueue(SyncMutationName.ScheduleOwnerMessageHeard, { farmId: place.farmId, plotId: place.plotId, messageId }, { clientRequestId: id, clientCommandId: id });
    }

    static async decide(place: OwnerPlace, messageId: string, decision: OwnerDecision): Promise<void> {
        const id = `ownermsg.decide:${place.plotId}:${messageId}:${idGenerator.generate()}`;
        await mutationQueue.enqueue(
            SyncMutationName.ScheduleOwnerMessageDecide,
            { farmId: place.farmId, plotId: place.plotId, cropCycleId: place.cropCycleId, messageId, decision },
            { clientRequestId: id, clientCommandId: id },
        );
    }

    static async answer(place: OwnerPlace, messageId: string, answer: OwnerAnswer): Promise<void> {
        const id = `ownermsg.answer:${place.plotId}:${messageId}`;
        await mutationQueue.enqueue(
            SyncMutationName.ScheduleOwnerMessageAnswer,
            { farmId: place.farmId, plotId: place.plotId, cropCycleId: place.cropCycleId, messageId, answer },
            { clientRequestId: id, clientCommandId: id },
        );
    }
}
