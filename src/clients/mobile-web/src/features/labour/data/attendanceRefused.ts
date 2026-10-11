/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour journey fixes (D1 + D6, spec 2026-08-25-prod-cutover-waves) — what
 * the SERVER REFUSED, found again where the farmer is looking.
 *
 * WHY: `लक्षात ठेवलं ✓` at save time means "queued on this phone", and it is
 * true. But a mark whose grant has expired (or never existed) comes back from
 * /sync/push as HTTP 200 with a per-mutation `failed` / `ShramSafal.Forbidden`;
 * RejectionPolicy parks it (`REJECTED_USER_REVIEW`) and, until now, the only
 * place that said so was the app-wide ⚠ page. The Labour screens went on
 * showing the refused mark as remembered, and a refused no-work declaration
 * (`create_daily_log`) failed without a word.
 *
 * This is a READ of the existing parked rows - the same store the ⚠ badge
 * counts. It builds no queue, no engine and no second source of truth.
 *
 * SCOPE: an unanswered AttendanceContradiction is NOT a refusal of the
 * farmer's statement - it is a question, and `attendanceParked.ts` renders
 * it. Everything else parked on an attendance.mark is a refusal.
 */
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';
import type { AttendanceMarkPayload } from '../../../application/usecases/sync/MarkAttendanceCommand';
import type { CreateDailyLogPayload } from '../../../application/usecases/sync/CreateDailyLogCommand';

export interface RefusedLabourMark {
    clientRequestId: string;
    fieldOperatorId: string;
    workDate: string;
    dayMark?: string;
    nightMark?: string;
    /**
     * True only when the server's own code says the caller may not take these
     * marks (`ShramSafal.Forbidden`). Any other code claims NO reason.
     */
    missingResponsibility: boolean;
}

export interface RefusedLabourState {
    marks: RefusedLabourMark[];
    /**
     * The no-work declaration (`काम झालं नाही`) did not reach the server: the
     * server refused it, or the phone has given up retrying. A declaration
     * that is merely waiting or retrying is NOT reported - it is not a failure.
     */
    noWorkDeclarationRefused: boolean;
    /** The queue rows behind the above - the handles a retry needs. */
    clientRequestIds: string[];
}

export const EMPTY_REFUSED_LABOUR_STATE: RefusedLabourState = {
    marks: [], noWorkDeclarationRefused: false, clientRequestIds: [],
};

/** The RejectionPolicy.normalizeCode rule: the dot-tail, upper-cased. */
const tailOf = (code: string | undefined): string =>
    code ? code.slice(code.lastIndexOf('.') + 1).trim().toUpperCase() : '';

/** An attendance.mark row parked with this code is a question, not a refusal. */
export const isContradictionCode = (code: string | undefined): boolean =>
    tailOf(code) === 'ATTENDANCECONTRADICTION';

export const isForbiddenCode = (code: string | undefined): boolean => tailOf(code) === 'FORBIDDEN';

export async function listRefusedLabourState(farmId: string): Promise<RefusedLabourState> {
    const [rejected, failed] = await Promise.all([
        mutationQueue.getRejectedUserReview(),
        mutationQueue.getCapExhaustedFailed(),
    ]);

    const marks: RefusedLabourMark[] = [];
    const clientRequestIds: string[] = [];
    let noWorkDeclarationRefused = false;

    // A mark is "refused" only when the server parked it. A retry-capped
    // transport failure (FAILED) is not a verdict - it stays weaker intent.
    for (const row of rejected) {
        if (row.mutationType !== SyncMutationName.AttendanceMark) continue;
        if (isContradictionCode(row.errorCode)) continue;
        const p = row.payload as AttendanceMarkPayload;
        if (p.farmId !== farmId) continue;
        marks.push({
            clientRequestId: row.clientRequestId,
            fieldOperatorId: p.fieldOperatorId,
            workDate: p.workDate,
            ...(p.dayMark ? { dayMark: p.dayMark } : {}),
            ...(p.nightMark ? { nightMark: p.nightMark } : {}),
            missingResponsibility: isForbiddenCode(row.errorCode),
        });
        clientRequestIds.push(row.clientRequestId);
    }

    // The no-work declaration is the daily-log mutation carrying the farmer's
    // `NO_WORK_PLANNED` statement. Refused (parked) or out of retries = it
    // did not reach the farm record.
    for (const row of [...rejected, ...failed.filter((r) => r.retryCount >= MAX_AUTO_RETRY_COUNT)]) {
        if (row.mutationType !== SyncMutationName.CreateDailyLog) continue;
        const p = row.payload as CreateDailyLogPayload;
        if (p.farmId !== farmId) continue;
        if (p.manualDraft?.dayOutcome !== 'NO_WORK_PLANNED') continue;
        noWorkDeclarationRefused = true;
        clientRequestIds.push(row.clientRequestId);
    }

    return { marks, noWorkDeclarationRefused, clientRequestIds };
}
