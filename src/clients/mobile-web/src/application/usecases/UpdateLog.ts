import { DailyLog, LabourEvent, LogVerificationStatus } from '../../domain/types/log.types';
import { FarmerProfile } from '../../domain/types/farm.types';
import { PatchEvent } from '../../domain/ledger/PatchEvent';
import { LogsRepository } from '../ports';
import {
    finiteOrOmitted,
    resolveLogFarmId,
    wholeOrOmitted,
} from '../../features/logs/services/logSyncMutationService';
import {
    postLabourCorrection,
    type LabourCorrectionRequest,
} from '../../features/labour/data/labourCorrectionsClient';
// import { AuditLogRepository } from '../../infrastructure/storage/AuditLogRepository'; // Deprecated Fix-07

interface UpdateLogRequest {
    logId: string;
    updatedData: Partial<DailyLog>;
    actorId: string;
    reason: string;
}

interface UpdateLogResponse {
    success: boolean;
    error?: string;
    log?: DailyLog;
}

/** One engagement's worth of correction, ready to POST. */
interface PendingLabourCorrection {
    labourAssignmentId: string;
    request: LabourCorrectionRequest;
}

/**
 * Labour V1 Task 12b.7 — the LABOUR portion of an edit, expressed as
 * corrections.
 *
 * Engagements are matched by `labourAssignmentId` (Task 7's client-minted,
 * stable engagement id) because that is the id the server keys corrections on.
 * An engagement with no id has no server-side identity to correct, and a newly
 * added or fully removed engagement is not a correction of an existing one — all
 * three are skipped rather than guessed at.
 *
 * ONLY CHANGED FIELDS TRAVEL, and unstated ones are OMITTED, not coerced. The
 * same omit-don't-coerce rule as `buildLabourPayloads`: `parseFloat('')` is NaN
 * and `type="number"` inputs accept "2.5" in a headcount box, so a value that
 * cannot be sent honestly is dropped. Omitting `durationHours` is what leaves an
 * `Assumed` duration untouched server-side — silence is not a correction.
 */
export function buildLabourCorrections(
    existingLog: DailyLog,
    finalLog: DailyLog,
    reason?: string,
): PendingLabourCorrection[] {
    const before = new Map<string, LabourEvent>();
    for (const event of existingLog.labour || []) {
        if (event.labourAssignmentId) {
            before.set(event.labourAssignmentId, event);
        }
    }

    const corrections: PendingLabourCorrection[] = [];

    for (const event of finalLog.labour || []) {
        const id = event.labourAssignmentId;
        if (!id) {
            continue;
        }

        const original = before.get(id);
        if (!original) {
            continue;
        }

        const workerCount = wholeOrOmitted(event.count);
        const maleCount = wholeOrOmitted(event.maleCount);
        const femaleCount = wholeOrOmitted(event.femaleCount);
        const quantityChanged =
            workerCount !== wholeOrOmitted(original.count) ||
            maleCount !== wholeOrOmitted(original.maleCount) ||
            femaleCount !== wholeOrOmitted(original.femaleCount);

        // A duration is corrected only when the reviewer STATES a positive one.
        // Clearing the field is silence, not "zero hours worked", so it leaves
        // the server's recorded value exactly as it was.
        const durationHours = finiteOrOmitted(event.durationHours);
        const durationChanged =
            durationHours !== undefined &&
            durationHours > 0 &&
            durationHours !== finiteOrOmitted(original.durationHours);

        if (!quantityChanged && !durationChanged) {
            continue;
        }

        const request: LabourCorrectionRequest = {
            // A FRESH id per submit is correct here, and safer than a
            // value-derived one. There is no offline queue behind this call, so
            // there is no transport-level retry to dedupe; the key exists to stop
            // ONE action being applied twice. The server writes a history row
            // only for a field that actually CHANGED, so re-submitting the same
            // values after a lost response is already a no-op — whereas a
            // value-derived key would collide across a genuine 8 -> 6 -> 8 -> 6
            // sequence and silently refuse the third correction.
            clientRequestId: crypto.randomUUID(),
            ...(reason ? { reason } : {}),
            ...(quantityChanged
                ? {
                      quantity: {
                          ...(workerCount !== undefined && { workerCount }),
                          ...(maleCount !== undefined && { maleCount }),
                          ...(femaleCount !== undefined && { femaleCount }),
                      },
                  }
                : {}),
            ...(durationChanged && { durationHours }),
        };

        corrections.push({ labourAssignmentId: id, request });
    }

    return corrections;
}

/**
 * UpdateLog Use-Case
 *
 * Handles secure updates to execution logs.
 * Enforces "Immutable Verification" rule:
 * - If log is APPROVED, create a PatchEvent and reset status to PENDING.
 *
 * PERSISTENCE, HONESTLY (Labour V1 Task 12b.7): the LABOUR portion of an edit is
 * sent to the Task 12b correction route and is genuinely persisted. Every other
 * edit category — crop activities, irrigation, inputs, machinery, expenses — has
 * NO server-side persistence path yet, so this use case still does not persist
 * them. That is deliberate (P5): a truthful missing feature beats a fake working
 * one, and the alternative is what step 12b.7b deleted.
 *
 * WHAT 12b.7b DELETED, AND WHY IT MUST NOT COME BACK. This function used to
 * enqueue `SyncMutationName.AddLogTask` with
 * `{dailyLogId, action, updatedData, reason, actorId}`. The server's allow-list
 * (`PushSyncBatchHandler.PayloadHasOnly(payload, "logTaskId", "dailyLogId",
 * "activityType", "notes", "occurredAtUtc")`) rejects that payload
 * PERMANENTLY — four keys unknown, three required ones missing — so every log
 * edit a farmer made enqueued a mutation that could only ever fail with
 * `ShramSafal.SyncInvalidPayload`. Leaving it in place while adding a correction
 * call that works would have quietly filled the queue with permanent failures
 * underneath a feature that now looks healthy.
 */
export const updateLog = async (
    request: UpdateLogRequest,
    repo: LogsRepository,
    // auditRepo deprecated (Fix-07)
    _actorProfile: FarmerProfile
): Promise<UpdateLogResponse> => {
    try {
        // 1. Fetch existing
        const existingLog = await repo.getById(request.logId);
        if (!existingLog) {
            return { success: false, error: 'Log not found.' };
        }

        // 2. Prepare Update Logic
        const finalLog: DailyLog = { ...existingLog, ...request.updatedData };

        // 3. Handle Verification Invariance
        if (existingLog.verification?.status === LogVerificationStatus.APPROVED ||
            existingLog.verification?.status === LogVerificationStatus.AUTO_APPROVED) {

            // Create SNAPSHOT (Patch)
            const patch: PatchEvent = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                actorId: request.actorId,
                reason: request.reason || 'Edit to verified log',
                previousState: {
                    date: existingLog.date,
                    weatherStamp: existingLog.weatherStamp,
                    cropActivities: existingLog.cropActivities,
                    irrigation: existingLog.irrigation,
                    labour: existingLog.labour,
                    inputs: existingLog.inputs,
                    machinery: existingLog.machinery,
                    activityExpenses: existingLog.activityExpenses,
                    observations: existingLog.observations,
                    plannedTasks: existingLog.plannedTasks,
                    disturbance: existingLog.disturbance,
                    verification: existingLog.verification
                }
            };

            // Reset Verification Status
            finalLog.verification = {
                status: LogVerificationStatus.PENDING,
                required: true,
                notes: 'Reset due to edit after verification.'
            };

            // Append Patch
            finalLog.patches = [...(existingLog.patches || []), patch];
        }

        // 4. Persist the LABOUR portion of the edit (Task 12b.7).
        //    A failure here is REPORTED, never swallowed: the caller
        //    (`useLogCommands.handleManualSubmit`) throws on `success: false`, so
        //    the farmer learns the correction did not land instead of seeing a
        //    success toast over an unchanged record.
        const corrections = buildLabourCorrections(existingLog, finalLog, request.reason);
        if (corrections.length > 0) {
            const farmId = await resolveLogFarmId(existingLog);
            if (!farmId) {
                return {
                    success: false,
                    error: 'Cannot correct labour: this log has no synced plot, so its farm is unknown.',
                };
            }

            for (const correction of corrections) {
                await postLabourCorrection(farmId, correction.labourAssignmentId, correction.request);
            }
        }

        return { success: true, log: finalLog };

    } catch (e: unknown) {
        // Narrowed rather than `any` (the shape this used to carry): the pre-commit
        // ESLint gate runs --max-warnings 0, so an `any` left here would block every
        // future commit that touches this file.
        console.error('UpdateLog Error:', e);
        const message = e instanceof Error ? e.message : undefined;
        return { success: false, error: message || 'Unknown error during update' };
    }
};
