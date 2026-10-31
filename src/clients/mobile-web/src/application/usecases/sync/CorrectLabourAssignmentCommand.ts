import { v5 as uuidv5 } from 'uuid';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { LabourQuantityCorrectionRequest } from '../../../features/labour/data/labourCorrectionsClient';

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1) — a worker-count / hours correction on a
 * SAVED entry, QUEUED like every other change instead of POSTed now, so it works with no internet (P10). The server
 * runs it through the same handler as the online route (`correct_labour_assignment.zod.ts`).
 */
export interface CorrectLabourAssignmentPayload {
    labourAssignmentId: string;
    /** The pull guard reads this key, so the entry keeps his change until the server has answered. */
    dailyLogId: string;
    farmId: string;
    /** Absent = he said nothing about the headcount (silence is not a correction). */
    quantity?: LabourQuantityCorrectionRequest;
    /** Absent = he said nothing about the hours. */
    durationHours?: number;
    /** What his phone showed before his change — only the values it knew. A newer change on the server refuses this one. */
    seen: { workerCount?: number; maleCount?: number; femaleCount?: number; durationHours?: number };
    reason?: string;
    correctedAtUtc: string;
}

/** NEVER CHANGE: every queued count correction's request id is derived under it. */
const CORRECTION_REQUEST_NAMESPACE = 'ce0aa65f-a2cf-4d1b-9966-bf8e756d4024';

/**
 * The request id of one correction: the engagement, the record version he saw, what he saw and what he changed it to.
 * Pressing "जतन करा" again after a failed step queues the SAME correction, never a second one. A genuine 8 → 6 → 8 → 6
 * is never mistaken for a repeat: each step is made from a newer record version.
 */
export const correctionRequestId = (p: CorrectLabourAssignmentPayload, seenVersion: number): string =>
    `${SyncMutationName.CorrectLabourAssignment}:${p.labourAssignmentId}:${uuidv5(JSON.stringify([
        p.labourAssignmentId, seenVersion, p.seen, p.quantity ?? null, p.durationHours ?? null,
    ]), CORRECTION_REQUEST_NAMESPACE)}`;

export class CorrectLabourAssignmentCommand {
    static async enqueue(payload: CorrectLabourAssignmentPayload, seenVersion: number): Promise<string> {
        const clientRequestId = correctionRequestId(payload, seenVersion);
        return mutationQueue.enqueue(SyncMutationName.CorrectLabourAssignment, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
