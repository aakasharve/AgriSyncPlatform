import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3). The wire twin of
// sync-contract/schemas/payloads/create_plot.zod.ts. `plotId` is required HERE (optional on
// the wire): the phone mints it, keeps it, and the server must use the same id, or the
// plot the farmer sees and the plot his logs point at would be two different plots.
export interface CreatePlotPayload {
    plotId: string;
    farmId: string;
    name: string;
    areaInAcres: number;
}

export class CreatePlotCommand {
    /** Stable idempotency key from the plot's own id — a second enqueue of the same plot collapses. */
    static async enqueue(payload: CreatePlotPayload): Promise<string> {
        const clientRequestId = `${SyncMutationName.CreatePlot}:${payload.plotId}`;
        return mutationQueue.enqueue(SyncMutationName.CreatePlot, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
