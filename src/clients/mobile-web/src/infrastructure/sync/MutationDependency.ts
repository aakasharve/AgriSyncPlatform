/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 — DEPENDENCY-PENDING: the THIRD failure class.
 *
 * WHAT WAS BROKEN
 * ---------------
 * A child mutation — `add_log_task`, `verify_log`, `jobcard.complete`, an
 * attachment linked to a log — is refused by the server with
 * `ShramSafal.DailyLogNotFound` whenever its parent `create_daily_log` has not
 * landed. `categorizeRejection` has never had a case for it: the code
 * normalises to `DAILYLOGNOTFOUND`, which is not in `PERMANENT_REJECTION_CODES`
 * (`NOT_FOUND` is a different string, and the message "Daily log was not found."
 * contains no permanent code either), so the row classifies RETRYABLE and is
 * CHARGED. Five cycles later it is cap-exhausted `FAILED` — a status the
 * conflict screen did not read (see box 2d) — and the farmer's record is
 * stranded with no remedy and no explanation.
 *
 * The distinction this module draws is not "may this succeed later?" but
 * "WHOSE fault is it?". A child refused for its parent's sake was never judged
 * on its own merits, so charging it the cap is the same defect
 * `MutationFailureKind.TRANSPORT` was introduced to fix, one layer up.
 *
 * WHY THE OBVIOUS RULE LOOPS FOREVER — READ THIS BEFORE EDITING
 * ------------------------------------------------------------
 * The tempting rule is "if the parent is still open, keep retrying the child".
 * "Still open" is satisfied by a parent parked in `REJECTED_USER_REVIEW` —
 * neither applied nor discarded — and by a cap-exhausted `FAILED` parent.
 * Neither will EVER move without a tap. So the child stays retryable and
 * UNCHARGED and re-pushes every 15 seconds for the life of the install, never
 * escalating to anything the farmer can see. That is strictly worse than the
 * bug: an invisible defect becomes an invisible defect that also burns battery
 * and mobile data.
 *
 * So the two sets are ENUMERATED, not described. `PARENT_STATUS_CLASS` below is
 * a `Record<MutationQueueStatus, ...>`, which makes it exhaustive at COMPILE
 * time: a seventh mutation status cannot be added without deciding which side
 * of this line it falls on. Do not replace it with a predicate.
 *
 * WHY THE LOOKUP IS KEYED AND NOT SCANNED (box 2b)
 * ------------------------------------------------
 * The naive form of "find the parent" matches on payload CONTENT in ANY status.
 * `mutationQueue` indexes only `&[deviceId+clientRequestId]`, `status`,
 * `mutationType`, `createdAt` and `[status+createdAt]` — nothing reaches inside
 * `payload` — and `APPLIED` rows are deliberately never pruned (the crash
 * reconciler needs them). So the naive form is an unindexed scan over a
 * monotonically growing table, per child, every cycle.
 *
 * It is KEYED instead. `CreateDailyLogCommand.enqueue` mints
 * `create_daily_log:${dailyLogId}` as the parent's `clientRequestId`
 * (`CreateDailyLogCommand.ts:129`), so the parent's key is DERIVABLE from the
 * child's payload and the lookup is a single equality hit on the existing
 * UNIQUE compound index. One B-tree descent, status-independent, no new index,
 * and therefore NO DEXIE VERSION BUMP.
 *
 * Keying is not merely cheaper here, it is the only option that avoids a bump:
 * the parent id lives under a DIFFERENT payload key per mutation type
 * (`dailyLogId` / `logId` / `linkedEntityId`), so no single Dexie keyPath could
 * have indexed it anyway.
 */
import { getDatabase, type MutationQueueStatus } from '../storage/DexieDatabase';
import { MAX_AUTO_RETRY_COUNT } from './retryCap';
import { SyncMutationName } from './SyncMutationCatalog';

/**
 * Where the parent daily-log id lives inside each child mutation's payload.
 *
 * Every entry is grounded in a schema that is checked in, not guessed:
 * `add_log_task.zod.ts:9`, `verify_log.zod.ts:10`, `verify_log_v2.zod.ts:5`,
 * `jobcard_complete.zod.ts:8`. A mutation type absent from this table is not a
 * daily-log child as far as this client is concerned, and the dependency rule
 * simply does not fire for it — the existing classification stands.
 */
const DAILY_LOG_PARENT_FIELD: Readonly<Record<string, string>> = {
    [SyncMutationName.AddLogTask]: 'dailyLogId',
    [SyncMutationName.VerifyLog]: 'dailyLogId',
    [SyncMutationName.VerifyLogV2]: 'logId',
    [SyncMutationName.JobcardComplete]: 'dailyLogId',
};

/**
 * `create_attachment` is the one child whose parent is CONDITIONAL: the same
 * payload can link to a farm, a cost entry or a daily log, and only the last of
 * those can produce `DailyLogNotFound`.
 *
 * The literal is the server's, read from `CreateAttachmentHandler.cs:109`
 * (`linkedEntityType.Equals("dailylog", OrdinalIgnoreCase)`), not invented here.
 * No surface in this client currently emits it — `CaptureAttachment.ts:156`
 * defaults to `Farm`, and the two call sites pass `Farm` and `TestInstance` —
 * so this branch is dormant today and is written to be correct on the day one
 * does, rather than to be exercised now.
 */
const ATTACHMENT_DAILY_LOG_ENTITY_TYPE = 'dailylog';

/**
 * How a parent's queue status bears on its children.
 *
 * `Record<MutationQueueStatus, ...>` on purpose — see the header. The failure
 * mode of an unclassified status must never be "keep the child retrying".
 */
type ParentStatusClass =
    /** the parent is still moving by itself; the child should wait */
    | 'IN_PROGRESS'
    /** nothing will move the parent without a tap; the child must escalate */
    | 'UNRECOVERABLE'
    /** depends on the auto-retry cap — resolved by `classifyParentStatus` */
    | 'CAP_DEPENDENT'
    /** the server already has this log; a refusal is about something else */
    | 'SATISFIED';

const PARENT_STATUS_CLASS: Record<MutationQueueStatus, ParentStatusClass> = {
    PENDING: 'IN_PROGRESS',
    SENDING: 'IN_PROGRESS',
    FAILED: 'CAP_DEPENDENT',
    REJECTED_USER_REVIEW: 'UNRECOVERABLE',
    REJECTED_DROPPED: 'UNRECOVERABLE',
    APPLIED: 'SATISFIED',
};

export type DependencyDisposition =
    /** parent PENDING / SENDING / FAILED below the cap -> retryable, uncharged, backed off */
    | 'PARENT_IN_PROGRESS'
    /**
     * parent REJECTED_USER_REVIEW / REJECTED_DROPPED / FAILED cap-exhausted /
     * ABSENT -> reject the child durably, NAMING the parent.
     */
    | 'PARENT_UNRECOVERABLE'
    /**
     * Either this mutation has no daily-log parent, or the parent is `APPLIED`.
     *
     * `APPLIED` is deliberately in NEITHER of the two enumerated sets. The
     * server has acknowledged this log, so a `DailyLogNotFound` about it is not
     * a dependency problem at all — it is the server saying something this
     * module has no business reinterpreting (a tenant/RLS scope, a deletion, a
     * different account). The caller falls through to the ordinary
     * classification, which is exactly what happens today. Inventing a verdict
     * here would be a guess dressed as a diagnosis.
     */
    | 'NOT_A_DEPENDENCY';

export interface DependencyVerdict {
    disposition: DependencyDisposition;
    /** The parent daily-log id, when one could be read off the payload. */
    parentDailyLogId?: string;
    /** The key the lookup used — `create_daily_log:{id}`. */
    parentClientRequestId?: string;
    /** The parent's queue status, or `undefined` when there is no parent row. */
    parentStatus?: MutationQueueStatus;
}

function readStringField(payload: unknown, field: string): string | null {
    if (typeof payload !== 'object' || payload === null) {
        return null;
    }

    const value = (payload as Record<string, unknown>)[field];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The daily-log id this mutation depends on, or `null` if it depends on none.
 *
 * PURE — no Dexie, so the mapping table is unit-testable on its own.
 */
export function parentDailyLogIdOf(mutationType: string, payload: unknown): string | null {
    const field = DAILY_LOG_PARENT_FIELD[mutationType];
    if (field) {
        return readStringField(payload, field);
    }

    if (mutationType === SyncMutationName.CreateAttachment) {
        const entityType = readStringField(payload, 'linkedEntityType');
        if (entityType?.toLowerCase() !== ATTACHMENT_DAILY_LOG_ENTITY_TYPE) {
            return null;
        }
        return readStringField(payload, 'linkedEntityId');
    }

    return null;
}

/**
 * The parent's `clientRequestId`, derived — never looked up.
 *
 * This is the whole of box 2b. It works ONLY because
 * `CreateDailyLogCommand.enqueue` derives the same string from the same log id;
 * if that key ever becomes randomly minted, this lookup silently starts
 * answering "absent" for every child and every one of them gets rejected.
 * `__tests__/MutationDependency.test.ts` pins the two together.
 */
export function parentClientRequestIdForDailyLog(dailyLogId: string): string {
    return `${SyncMutationName.CreateDailyLog}:${dailyLogId}`;
}

function classifyParentStatus(
    status: MutationQueueStatus,
    retryCount: number,
): 'PARENT_IN_PROGRESS' | 'PARENT_UNRECOVERABLE' | 'NOT_A_DEPENDENCY' {
    switch (PARENT_STATUS_CLASS[status]) {
        case 'IN_PROGRESS':
            return 'PARENT_IN_PROGRESS';
        case 'UNRECOVERABLE':
            return 'PARENT_UNRECOVERABLE';
        case 'CAP_DEPENDENT':
            // At or over the cap `markFailedAsPending` stops flipping the parent
            // back to PENDING (`MutationQueue.flipFailedToPending`), so nothing
            // in the app will move it again without a tap. Same number, same
            // rule as `stuckMutations.needsFarmerAction` and the chip's
            // `NEEDS_FIX` branch — one constant, three readers, no literals.
            return retryCount >= MAX_AUTO_RETRY_COUNT
                ? 'PARENT_UNRECOVERABLE'
                : 'PARENT_IN_PROGRESS';
        case 'SATISFIED':
            return 'NOT_A_DEPENDENCY';
    }
}

/**
 * Resolve what a child's parent daily log is doing right now.
 *
 * ONE indexed equality lookup on `&[deviceId+clientRequestId]`. No table scan,
 * no payload matching, no status filter — the parent counts in ANY status,
 * which is the requirement, and the unique index gives that for free.
 */
export async function resolveDailyLogDependency(
    deviceId: string,
    mutationType: string,
    payload: unknown,
): Promise<DependencyVerdict> {
    const parentDailyLogId = parentDailyLogIdOf(mutationType, payload);
    if (!parentDailyLogId) {
        return { disposition: 'NOT_A_DEPENDENCY' };
    }

    const parentClientRequestId = parentClientRequestIdForDailyLog(parentDailyLogId);
    const parent = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([deviceId, parentClientRequestId])
        .first();

    if (!parent) {
        // ABSENT. Nothing on this device will ever create that log on the
        // server, so no amount of waiting helps the child. Escalate now rather
        // than after five charged retries into a status nothing reads.
        return {
            disposition: 'PARENT_UNRECOVERABLE',
            parentDailyLogId,
            parentClientRequestId,
        };
    }

    return {
        disposition: classifyParentStatus(parent.status, parent.retryCount),
        parentDailyLogId,
        parentClientRequestId,
        parentStatus: parent.status,
    };
}

/**
 * The machine-stable token carried in `lastError` for a dependency rejection.
 *
 * `ConflictResolutionService.hintFor` matches on it to render the Marathi
 * remedy, the same way it matches the server's own codes. Kept as one exported
 * constant so the producer and the matcher cannot drift.
 */
export const DEPENDENCY_PARENT_UNRESOLVED_CODE = 'DEPENDENCY_PARENT_UNRESOLVED';

/**
 * The `lastError` written while the child is WAITING on a live parent.
 *
 * This row is `FAILED` and uncharged, so nothing escalates it — which means
 * this string is the only place the reason is recorded. It says which log is
 * being waited on and that the attempt was free, so a support read of the queue
 * does not mistake a patient child for a burning one.
 */
export function describeDependencyWait(verdict: DependencyVerdict): string {
    return `Waiting for daily log ${verdict.parentDailyLogId ?? '(unknown)'} to reach the server `
        + `(${verdict.parentStatus ?? 'UNKNOWN'}). This attempt was not counted against the retry limit.`;
}

/**
 * The rejection text, NAMING THE PARENT.
 *
 * Naming it is load-bearing, not decorative: a rejection the farmer cannot
 * trace to a cause is not resolvable, and the whole point of promoting this row
 * to the conflict screen is that it becomes resolvable. The parent's id and its
 * current state are the two facts that say what to go and fix.
 *
 * States only what is known. When there is no parent row the text says the
 * record is missing — it does not speculate about why.
 */
export function describeDependencyRejection(verdict: DependencyVerdict): string {
    const parentState = verdict.parentStatus
        ? `its state here is ${verdict.parentStatus}`
        : 'it is not in this device\'s queue at all';

    return `${DEPENDENCY_PARENT_UNRESOLVED_CODE}: the server has no daily log `
        + `${verdict.parentDailyLogId ?? '(unknown)'}, and ${parentState}. `
        + 'This record cannot be sent until that log reaches the server.';
}
