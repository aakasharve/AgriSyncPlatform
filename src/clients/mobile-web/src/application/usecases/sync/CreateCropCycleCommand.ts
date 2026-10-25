import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3). The wire twin of
// sync-contract/schemas/payloads/create_crop_cycle.zod.ts, with `cropCycleId` required here
// for the same reason as `CreatePlotCommand.plotId`: a log on this plot is attributed to
// this cycle by id before the server has ever seen it.
export interface CreateCropCyclePayload {
    cropCycleId: string;
    farmId: string;
    plotId: string;
    cropName: string;
    stage: string;
    /** YYYY-MM-DD */
    startDate: string;
    endDate?: string;
}

export class CreateCropCycleCommand {
    static async enqueue(payload: CreateCropCyclePayload): Promise<string> {
        const clientRequestId = `${SyncMutationName.CreateCropCycle}:${payload.cropCycleId}`;
        return mutationQueue.enqueue(SyncMutationName.CreateCropCycle, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
