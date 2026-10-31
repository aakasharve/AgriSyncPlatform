import { v5 as uuidv5 } from 'uuid';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1, D-61 = 5A) — a SAVED entry moved to
 * another place and/or day (`move_daily_log.zod.ts`), queued so it works with no internet (P10). The server refuses a
 * move made from an older version, a future day, a plot with no season that day and a move that would leave हजेरी or
 * money behind; the phone then puts the entry back to the server's version and says why (`refusedRevision.ts`).
 */
export interface MoveDailyLogPayload {
    /** The pull guard reads this key, so the moved entry is left alone until the server has answered. */
    dailyLogId: string;
    /** The record version he saw (after his own changes queued before this one). */
    baseVersion: number;
    /** The plot(s) he chose; absent = the place does not change. */
    newPlotIds?: string[];
    /** He chose the whole farm. */
    wholeFarm?: true;
    /** yyyy-MM-dd; absent = the day does not change. */
    newLogDate?: string;
    reason?: string;
    revisedAtUtc: string;
}

/** NEVER CHANGE: every queued move's request id is derived under it. */
const MOVE_REQUEST_NAMESPACE = 'bcbf4442-f711-4cc8-be64-2c20cb742949';

/**
 * The request id of one move: the record, the version he saw and where it goes. Pressing "जतन करा" again after a
 * failed step therefore queues the SAME move (the queue keeps one row per request id), never a second one; a real
 * second move starts from a newer version and gets its own id.
 */
export const moveRequestId = (p: MoveDailyLogPayload): string =>
    `${SyncMutationName.MoveDailyLog}:${p.dailyLogId}:${uuidv5(JSON.stringify([
        p.dailyLogId, p.baseVersion, [...(p.newPlotIds ?? [])].sort(), p.wholeFarm === true, p.newLogDate ?? null,
    ]), MOVE_REQUEST_NAMESPACE)}`;

export class MoveDailyLogCommand {
    static async enqueue(payload: MoveDailyLogPayload): Promise<string> {
        const clientRequestId = moveRequestId(payload);
        // fix 1 (B001): the same change made again after a refusal is queued again (a refused row is re-armed).
        return mutationQueue.enqueueRepeatable(SyncMutationName.MoveDailyLog, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
