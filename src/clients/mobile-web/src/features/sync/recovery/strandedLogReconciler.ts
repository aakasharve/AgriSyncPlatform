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
 *    farmer never gave (`P4`). A log it cannot route is REPORTED — to
 *    `emitClientError`, which reaches a screen, not just a WebView console; see
 *    `reportToHumans` below for why counting it was not enough.
 *
 * 4. IT RESOLVES "THEN" WITH "THEN", NOT WITH "NOW" (review B001).
 *    The save path resolves a plot-scoped log's crop cycle from CURRENT
 *    reference data, ordering open cycles first. That is right when the enqueue
 *    happens seconds after the farmer speaks. It is WRONG here: a log stranded
 *    during last season's grape cycle — exactly the record this box exists to
 *    recover — would come back attributed to THIS season's open cycle, with the
 *    date correct and the attribution invented. That is a `cropCycleId` the
 *    farmer never gave, manufactured by the recovery itself.
 *
 *    So this passes `cycleResolution: 'from-log-date'`, which asks only which
 *    cycle's own dates CONTAIN the log's own date and refuses unless exactly one
 *    does. No sort, no open-cycle preference, no fallback. When the evidence does
 *    not identify the cycle the log is reported `unroutable` and stays on the
 *    device — absent beats wrong.
 *
 * 5. IT DELETES NOTHING. These rows are, by definition, the only copy.
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
 *
 * NETWORK COST IS ONE CYCLE, NOT K (review B004). `enqueueLogsForSync` ends in an
 * AWAITED `triggerNow()`, and this module calls it once per log — so the first
 * version drove K sequential push+pull+AI cycles at every app start, on rural
 * mobile data, for the population that by definition has a backlog. The per-log
 * isolation is kept (that function has none of its own); the round trips are not.
 * `triggerSync: false` on each call, one fire-and-forget trigger at the end, and
 * only if something was actually re-queued.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { parentClientRequestIdForDailyLog } from '../../../infrastructure/sync/MutationDependency';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { enqueueLogsForSync } from '../../logs/services/logSyncMutationService';
import { emitClientError } from '../../../core/telemetry/eventEmitters';
import type { DailyLog } from '../../../types';

/**
 * Review B005 — WHERE A HUMAN ACTUALLY SEES THIS.
 *
 * The first version of this module counted `unroutable` and `failed` into a
 * returned result and wrote them to `console.error`. The only production caller
 * discards the result, and `console.error` in a WebView on a farmer's Android
 * reaches nobody — so a record that is still stranded and still invisible, which
 * is the exact thing this box exists to surface, was counted and then dropped.
 * Counting is not reporting.
 *
 * `emitClientError` is the sink this codebase already has and already uses for
 * `window.onerror` (`index.tsx`): it writes to `analyticsOutbox`, which
 * `AnalyticsEventBus` drains to `POST /analytics/ingest`. It is offline-durable,
 * which matters here — the device this fires on is by definition one whose sync
 * has been failing.
 *
 * No farmer data leaves in these payloads: log ids and counts only, never
 * payloads, transcripts or notes.
 *
 * Everything goes in `message` because the frozen `client.error` vocabulary is
 * `{ farmId?, message, stack? }` (`eventSchema.ts:68`) and `emit` DROPS a
 * payload with extra keys rather than widening. Widening a frozen schema to
 * carry one module's diagnostics is not a trade worth making; a greppable
 * prefix is. `AdminOpsPage` already lists `client.error` rows.
 */
const REPORT_PREFIX = '[strandedLogReconciler]';

function reportToHumans(summary: string, context: Record<string, unknown>): void {
    const message = `${REPORT_PREFIX} ${summary} ${JSON.stringify(context)}`;

    // Telemetry must never be able to break a recovery pass. `emit` already
    // swallows schema failures by design; this guards the bus itself.
    try {
        emitClientError({ message });
    } catch {
        // fall through to the console line, which happens either way
    }

    console.error(JSON.stringify({
        level: 'error',
        component: 'strandedLogReconciler',
        message: summary,
        ...context,
        timestamp: new Date().toISOString(),
    }));
}

export interface StrandedLogReconcileResult {
    /** Non-deleted logs this device has never seen from the server. */
    examined: number;
    /** Logs that had no `create_daily_log` mutation row in ANY status. */
    stranded: number;
    /** Stranded logs that now have one. */
    requeued: number;
    /**
     * Stranded logs `resolveSyncTarget` still cannot route — a plot this device
     * has not pulled, plots that disagree about their farm, or (review B001) a
     * log whose own date does not land inside exactly one crop cycle.
     *
     * Each one is a record that IS STILL STRANDED AND STILL INVISIBLE, so each
     * one is reported through `reportToHumans`, not merely counted. Returning
     * the number and dropping it is what the first version of this module did.
     */
    unroutable: number;
    /** Stranded logs whose re-enqueue threw. Reported individually. */
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
 * data-loss bug for a silent sync outage — but nothing is merely counted:
 * every record left stranded is REPORTED through `reportToHumans`, which reaches
 * `analyticsOutbox` and therefore a screen, not just a WebView console.
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
        reportToHumans('Could not read the log table; stranded records were not scanned for', {
            error: error instanceof Error ? error.message : String(error),
        });
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
            reportToHumans('Could not check the mutation queue for this log; leaving it alone', {
                logId: log.id,
                error: error instanceof Error ? error.message : String(error),
            });
            continue;
        }

        if (!stranded) {
            continue;
        }

        result.stranded += 1;

        try {
            // ONE log per call. `enqueueLogsForSync` has no per-log isolation, so
            // a batch call would let one bad record cost every record behind it.
            //
            // `triggerSync: false` (review B004) — that function ends in an
            // AWAITED `triggerNow()`, so per-log calls would mean K sequential
            // push+pull+AI cycles at app start on a device that by definition has
            // a backlog. One cycle is fired below, after the whole pass.
            //
            // `cycleResolution: 'from-log-date'` (review B001) — see (4) in the
            // header. Recovery must not attribute last season's record to this
            // season's open cycle.
            const outcome = await enqueueLogsForSync([log], {
                triggerSync: false,
                cycleResolution: 'from-log-date',
            });
            result.requeued += outcome.queuedLogIds.length;
            result.unroutable += outcome.skippedLogIds.length;

            if (outcome.skippedLogIds.length > 0) {
                // STILL STRANDED. The plot has not been pulled, the plots
                // disagree about their farm, or the log's date does not identify
                // exactly one crop cycle. Nothing else in the app is looking for
                // this record, so this line is the only way anyone finds out.
                reportToHumans('A stranded record could not be routed and is still only on this device', {
                    logId: log.id,
                    logDate: log.date,
                });
            }
        } catch (error) {
            result.failed += 1;
            reportToHumans('Re-enqueue of a stranded log threw; the record is still only on this device', {
                logId: log.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Review B004 — ONE cycle for the whole pass, not one per log, and only if
    // there is something new to send. Fire-and-forget: a recovery pass must not
    // block worker start on a round trip.
    if (result.requeued > 0) {
        void backgroundSyncWorker.triggerNow().catch((error: unknown) => {
            reportToHumans('Recovered records were queued but the follow-up sync could not start', {
                requeued: result.requeued,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    if (result.stranded > 0 || result.failed > 0) {
        console.warn(JSON.stringify({
            level: 'warn',
            component: 'strandedLogReconciler',
            message: 'Records that had reached no sync queue',
            ...result,
            timestamp: new Date().toISOString(),
        }));
    }

    return result;
}
