/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1, final fix round, finding C-1.
 *
 * THE ONE THING THE CHIP CANNOT SEE, TOLD TO IT DIRECTLY
 * ------------------------------------------------------
 * `deriveSyncHonestyState` earns `ON_SERVER` from `acknowledgedCount > 0`. That
 * closed the fresh-install case and nothing else: `APPLIED` rows are NEVER
 * pruned (`SyncStatusService.ts:56-58`; the only `mutationQueue` deletion in the
 * client is the whole-table wipe at `DataSourceProvider.tsx:150`), so on any
 * device that has ever had one mutation applied the condition holds permanently
 * and unconditionally — and `ON_SERVER` is once again produced by the mere
 * ABSENCE of open rows.
 *
 * That absence is exactly what a dropped record looks like. A farmer who has
 * synced before saves a log whose plot has no crop cycle pulled down yet (or a
 * संपूर्ण शेत log): `resolveSyncTarget` returns null, the log is skipped, and
 * **no queue row is written at all**. On one sticky-header screen the farmer
 * then reads, simultaneously:
 *
 *     header chip   पाठवलं ✓                        ("Sent")
 *     panel         "Saved to Ledger"
 *     badge         फोनवर सेव्ह ✓ — cannot be sent
 *     toast         फोनवर सेव्ह ✓ — 1 of 1 cannot be sent.
 *
 * Three of those are right. The always-visible one makes the strongest claim
 * about the only record the farmer just created.
 *
 * WHY A REGISTRY RATHER THAN A QUERY
 * ----------------------------------
 * There is nothing to query. The record leaves no row in `mutationQueue`, no row
 * in `outbox`, no marker anywhere — that IS the defect. The only moment the app
 * ever holds the fact is the moment `enqueueLogsForSync` returns `skippedLogIds`
 * to the save path. So the save path tells the chip, through this module, and
 * the chip stops claiming a receipt it cannot produce.
 *
 * The claim it falls back to is `ON_PHONE`, which is TRUE and provable:
 * `confirmAndSave` wrote the log to `db.logs` before the enqueue was attempted.
 * It is also the same claim the toast and the panel badge already make about
 * that record, so four surfaces finally say one thing.
 *
 * SESSION-SCOPED, AND THAT IS DELIBERATE (`W6` — say what this does not do)
 * -------------------------------------------------------------------------
 * This is plain module state. It is gone on reload, and after a reload the chip
 * is back to reading a queue the record was never in. Making it durable needs
 * storage this phase is not allowed to add (no Dexie version bump, no schema
 * change), and — worse — durable state with no clearing path would latch
 * `ON_PHONE` forever, since no code path in Phase 1 will ever pick a skipped log
 * up. Phase 2 both changes the schema and removes the dominant cause of these
 * skips; the durable half belongs there. What is closed here is the window the
 * farmer can actually see: the save, and the rest of that session.
 *
 * NOT A FOURTH STATE, AND NOT A `NEEDS_FIX`. An unqueueable record weakens the
 * claim to `ON_PHONE`; it never strengthens the alarm. `अडकलं — तपासा` means
 * "the system is stuck and you can act", and there is nothing here to act on and
 * nowhere to go — the same reason the toast stopped saying `तपासा` (finding B3).
 *
 * No imports, on purpose: both a pure derivation module and a Dexie-backed
 * service read it, and neither should acquire the other's dependencies.
 */

/**
 * Log ids this session KNOWS reached no sync queue. A Set, not a counter: the
 * same log arriving twice (a re-submit of an unchanged draft) is one dropped
 * record, not two, and a count that could double is exactly the fabricated
 * figure `P4` forbids.
 */
const unqueueableLogIds = new Set<string>();

type UnqueueableListener = (count: number) => void;

const listeners = new Set<UnqueueableListener>();

function notifyListeners(): void {
    const count = unqueueableLogIds.size;
    for (const listener of listeners) {
        try {
            listener(count);
        } catch (err) {
            console.error('Error in unqueueable-log listener:', err);
        }
    }
}

/**
 * Records that these logs could not be queued for the server.
 *
 * Called by the save path with `enqueueLogsForSync(...).skippedLogIds`. An empty
 * array is a no-op and notifies nobody, so the happy path costs nothing — and
 * demo mode, which never enqueues at all, passes `[]` and makes no claim in
 * either direction.
 */
export function noteUnqueueableLogs(logIds: readonly string[]): void {
    if (logIds.length === 0) {
        return;
    }

    const sizeBefore = unqueueableLogIds.size;
    for (const logId of logIds) {
        unqueueableLogIds.add(logId);
    }

    if (unqueueableLogIds.size !== sizeBefore) {
        notifyListeners();
    }
}

/** How many distinct records this session knows it could not send. */
export function getUnqueueableLogCount(): number {
    return unqueueableLogIds.size;
}

/**
 * Subscribe to the count.
 *
 * `SyncStatusService` needs this because its `liveQuery` observes Dexie tables
 * only: a skipped log writes to none of them, so without an explicit
 * notification the chip would keep rendering its stale claim until some
 * unrelated queue write happened to re-fire the query.
 */
export function subscribeToUnqueueableLogs(listener: UnqueueableListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Forgets everything recorded so far.
 *
 * Used by tests to isolate module state. It is ALSO the call the user-switch
 * wipe should make — `DataSourceProvider.tsx:111-170` clears every Dexie table
 * including `db.logs`, so the previous user's dropped records genuinely stop
 * existing and a claim about them goes stale. That file is `.tsx` and behind the
 * UI gate this round, so the call is not wired; the residue is one weaker-than-
 * true `ON_PHONE` chip for a user who switched accounts mid-session, reported
 * rather than silently left. Do not "fix" it by making this durable.
 */
export function resetUnqueueableLogs(): void {
    if (unqueueableLogIds.size === 0) {
        return;
    }
    unqueueableLogIds.clear();
    notifyListeners();
}
