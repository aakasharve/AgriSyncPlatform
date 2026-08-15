/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * §P0.7 box 2e — THE CRASH RE-ENQUEUE RECONCILER.
 *
 * WHAT WAS BROKEN
 * ---------------
 * Saving a log is two writes: `DexieLogsRepository.batchSave` puts the row, then
 * `enqueueLogsForSync` writes the `create_daily_log` mutation. They are not in
 * one transaction. If the app dies in between — Android reclaims it, the battery
 * goes, the farmer swipes it away — the record exists on the handset and NOTHING
 * will ever tell the server about it. No screen shows it as unsent, because the
 * unsent-work surfaces all read the mutation queue and there is no row to read.
 * It is invisible, permanent, and it is the only copy.
 *
 * WHY A RECONCILER AND NOT AN ATOMIC TRANSACTION
 * ----------------------------------------------
 * A transaction would prevent the NEXT one. This also fixes:
 *   - the "plot not yet pulled" skip (`resolveSyncTarget` returns null, the save
 *     completes, no mutation row is written — an ORDINARY case, not a crash), and
 *   - records already stranded on farmers' phones today, which no transaction
 *     added tomorrow can reach.
 * A transaction is still worth having later; it is not a substitute for this.
 *
 * WHY THIS IS SAFE TO RUN — READ BEFORE CHANGING THE PREDICATE
 * ------------------------------------------------------------
 * 1. STABLE KEYS. `CreateDailyLogCommand.enqueue` derives the mutation's
 *    `clientRequestId` from the log's own id (`create_daily_log:{dailyLogId}`,
 *    `CreateDailyLogCommand.ts:129`), and `AddLogTaskCommand` does the same for
 *    tasks. So "has this log been enqueued?" is answerable by KEY, and a second
 *    enqueue collides with the unique `&[deviceId+clientRequestId]` index and is
 *    swallowed by `MutationQueue.enqueue`. Double-writing is not merely unlikely,
 *    it is structurally prevented. If that key ever becomes randomly minted this
 *    module MUST be disabled first — `__tests__/strandedLogReconciler.test.ts`
 *    pins the derivation so that change cannot land quietly.
 *
 * 2. THE SERVER-ORIGIN GUARD, which the bare predicate does not have.
 *    "No mutation row" is ALSO true of every log this device PULLED DOWN — a log
 *    created on the farmer's other handset, or by the seeder. Re-enqueueing those
 *    would push hundreds of already-stored logs back as fresh creates. So a log
 *    is only a candidate if it has NO `serverModifiedAtUtc`, i.e. this device has
 *    never received it from the server. That column has exactly one writer,
 *    `reconcileLogs` (`logsReconciler.ts:160`), it is preserved across every
 *    local write (`toRecordPreservingWatermark`), and `DailyLogDto.ModifiedAtUtc`
 *    is non-nullable server-side — so its presence is reliable evidence of server
 *    origin. This condition only ever NARROWS the candidate set; it can never
 *    cause an enqueue the bare predicate would not have made.
 *
 * 3. IT REUSES THE PRODUCTION PATH. `enqueueLogsForSync` is the same function the
 *    save path calls, given the same `DailyLog` read back out of Dexie. Nothing
 *    is reconstructed, defaulted or inferred, so this cannot invent a value the
 *    farmer never gave (`P4`). A log it cannot route is REPORTED as skipped, not
 *    quietly dropped.
 *
 * 4. IT DELETES NOTHING. These rows are, by definition, the only copy.
 *
 * WHY `APPLIED` MUTATION ROWS MUST NOT BE PRUNED
 * ----------------------------------------------
 * A successfully-synced log's only proof that it was ever enqueued is its
 * `APPLIED` mutation row. Prune those and this reconciler re-enqueues the
 * farmer's entire history on the next launch. Do not add pruning without
 * replacing this evidence first.
 *
 * COST, STATED PLAINLY
 * --------------------
 * Once per worker start, never inside the cycle. It streams the non-deleted logs
 * through the `isDeleted` index with `.each()` (flat memory, no `toArray()`), and
 * the watermark check rejects almost everything before any queue lookup happens —
 * on a synced device the candidate set is normally EMPTY and no keyed lookup runs
 * at all. What it does pay is one pass over the log rows at boot, which grows
 * with the farmer's history. That is the price of finding records nothing else
 * is looking for, and it is off the critical path: `start()` fires it without
 * awaiting it.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { parentClientRequestIdForDailyLog } from '../../../infrastructure/sync/MutationDependency';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { enqueueLogsForSync } from '../../logs/services/logSyncMutationService';
import type { DailyLog } from '../../../types';

export interface StrandedLogReconcileResult {
    /** Non-deleted logs this device has never seen from the server. */
    examined: number;
    /** Logs that had no `create_daily_log` mutation row in ANY status. */
    stranded: number;
    /** Stranded logs that now have one. */
    requeued: number;
    /**
     * Stranded logs `resolveSyncTarget` still cannot route — a plot this device
     * has not pulled, or plots that disagree about their farm. NOT a failure of
     * this module, and NOT hidden: the count is returned and logged so the
     * number is a fact someone can act on rather than a silence.
     */
    unroutable: number;
    /** Stranded logs whose re-enqueue threw. Logged individually. */
    failed: number;
}

/**
 * Has this log ever been handed to the sync queue, in any status?
 *
 * One equality hit on the unique `&[deviceId+clientRequestId]` index. `APPLIED`,
 * `REJECTED_DROPPED` and everything between all count as "yes" — the question is
 * whether the intent was ever recorded, not how it turned out.
 */
async function hasCreateMutation(deviceId: string, logId: string): Promise<boolean> {
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([deviceId, parentClientRequestIdForDailyLog(logId)])
        .first();

    return row !== undefined;
}

/**
 * Find logs that never reached the sync queue and put them back in it.
 *
 * Never throws. A reconciler that can break worker start would trade a silent
 * data-loss bug for a silent sync outage — but every failure is COUNTED and
 * LOGGED, never swallowed, because a recovery that cannot say what it recovered
 * is indistinguishable from one that did nothing.
 */
export async function reconcileStrandedLogs(): Promise<StrandedLogReconcileResult> {
    const result: StrandedLogReconcileResult = {
        examined: 0, stranded: 0, requeued: 0, unroutable: 0, failed: 0,
    };

    const deviceId = mutationQueue.getDeviceId();
    const candidates: DailyLog[] = [];

    try {
        await getDatabase().logs
            .where('isDeleted')
            .equals(0)
            .each((record) => {
                // Server-origin guard — see (2) in the header. A log this device
                // pulled down is already on the server by definition.
                if (record.serverModifiedAtUtc) {
                    return;
                }
                result.examined += 1;
                candidates.push(record.log);
            });
    } catch (error) {
        console.error(JSON.stringify({
            level: 'error',
            component: 'strandedLogReconciler',
            message: 'Could not read the log table; stranded records were not scanned for',
            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
            timestamp: new Date().toISOString(),
        }));
        return result;
    }

    for (const log of candidates) {
        let stranded: boolean;
        try {
            stranded = !(await hasCreateMutation(deviceId, log.id));
        } catch (error) {
            // The queue could not be read for this log. Treat it as NOT stranded:
            // "I could not check" must never become "so I re-sent it".
            result.failed += 1;
            console.error(JSON.stringify({
                level: 'error',
                component: 'strandedLogReconciler',
                logId: log.id,
                message: 'Could not check the mutation queue for this log; leaving it alone',
                error: error instanceof Error ? { message: error.message } : String(error),
                timestamp: new Date().toISOString(),
            }));
            continue;
        }

        if (!stranded) {
            continue;
        }

        result.stranded += 1;

        try {
            // ONE log per call. `enqueueLogsForSync` has no per-log isolation
            // (`logSyncMutationService.ts:503`), so a batch call would let one
            // bad record cost every record behind it.
            const outcome = await enqueueLogsForSync([log]);
            result.requeued += outcome.queuedLogIds.length;
            result.unroutable += outcome.skippedLogIds.length;
        } catch (error) {
            result.failed += 1;
            console.error(JSON.stringify({
                level: 'error',
                component: 'strandedLogReconciler',
                logId: log.id,
                message: 'Re-enqueue of a stranded log threw; the record is still only on this device',
                error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
                timestamp: new Date().toISOString(),
            }));
        }
    }

    if (result.stranded > 0 || result.failed > 0) {
        console.warn(JSON.stringify({
            level: 'warn',
            component: 'strandedLogReconciler',
            message: 'Recovered records that had reached no sync queue',
            ...result,
            timestamp: new Date().toISOString(),
        }));
    }

    return result;
}
