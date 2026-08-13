import { liveQuery, Subscription } from 'dexie';
import { getDatabase } from './DexieDatabase';
import { onActiveDatabaseChanged } from './activeDatabaseName';
import {
    deriveSyncHonestyState,
    EMPTY_SYNC_EVIDENCE,
    SYNC_HONESTY_OPEN_STATUSES,
    type SyncEvidenceSnapshot,
    type SyncHonestyClaim,
    type SyncHonestyState,
} from '../../features/sync/status/syncHonestyState';
import {
    getUnqueueableLogCount,
    resetUnqueueableLogs,
    subscribeToUnqueueableLogs,
} from '../../features/sync/status/unqueueableLogs';

export type { SyncHonestyState, SyncHonestyClaim };

type StatusListener = (claim: SyncHonestyClaim, lastSyncedAt?: Date) => void;

/** What one `liveQuery` tick reads: the claim's evidence plus the real sync time. */
export interface SyncEvidenceReading {
    evidence: SyncEvidenceSnapshot;
    /**
     * The last time this device completed a sync exchange with the server,
     * read from `db.syncCursors` — written by `MutationQueue.setCursor()` after
     * a successful pull. `undefined` means it has never happened.
     *
     * This is NOT stamped from a state transition. It used to be
     * `new Date()` on every hop into `ON_SERVER`, which meant a farmer opening
     * the app with an empty queue got "last synced: just now" for a sync that
     * never occurred — a fabricated timestamp (`P4`) waiting for a renderer.
     */
    lastSyncedAt?: Date;
}

/**
 * Reads everything the chip's claim depends on.
 *
 * Labour Phase 2 / T1: this used to read `db.outbox`, a table nothing drains,
 * which is why the chip claimed "Sending..." forever. `db.mutationQueue` is the
 * only store carrying a real per-mutation server acknowledgement
 * (`BackgroundSyncWorker.ts:224-226`). `db.outbox` still has all of its
 * writers — this task only removed it from the status READ path (`R1`).
 *
 * It also reads the upload and AI-job queues, because the chip's numeric badge
 * already counts them (`AppHeader.tsx:181-182`) and a label that ignores them
 * can contradict the badge on the same control.
 *
 * Exported so the repoint is directly testable: the singleton below owns a
 * process-wide `liveQuery` subscription that is never torn down, so tests must
 * not have to construct it.
 */
export async function readSyncEvidence(): Promise<SyncEvidenceReading> {
    const db = getDatabase();

    const openRows = await db.mutationQueue
        .where('status')
        .anyOf(...SYNC_HONESTY_OPEN_STATUSES)
        .toArray();

    // The one piece of positive evidence `ON_SERVER` may rest on. Counted
    // rather than fetched: `APPLIED` rows are never pruned.
    const acknowledgedCount = await db.mutationQueue.where('status').equals('APPLIED').count();

    const pendingUploads = await db.uploadQueue
        .where('status')
        .anyOf('pending', 'uploading', 'retry_wait')
        .count();
    const failedUploads = await db.uploadQueue.where('status').equals('failed').count();
    const pendingAiJobs = await db.pendingAiJobs.where('status').anyOf('pending', 'processing').count();

    const cursor = await db.syncCursors.get('shramsafal');
    const lastSyncAt = cursor?.lastSyncAt;

    return {
        evidence: {
            // Project down to the two fields the derivation needs. The chip has
            // no business retaining whole mutation payloads for the lifetime of
            // a never-unsubscribed liveQuery.
            rows: openRows.map(row => ({ status: row.status, retryCount: row.retryCount })),
            acknowledgedCount,
            pendingUploads,
            failedUploads,
            pendingAiJobs,
            // NOT a Dexie read — there is no row to read. A log
            // `resolveSyncTarget` refused writes nothing anywhere, which is why
            // the chip could claim `पाठवलं ✓` over it on any device that had
            // ever synced once (finding C-1). The save path records it in
            // memory instead; see `unqueueableLogs.ts`.
            unqueueableCount: getUnqueueableLogCount(),
        },
        lastSyncedAt: lastSyncAt ? new Date(lastSyncAt) : undefined,
    };
}

export class SyncStatusService {
    private static instance: SyncStatusService;
    /**
     * Starts at NO CLAIM. Before the first query resolves we have no evidence
     * of anything — not that records are stranded, not that they arrived. `R5`
     * forbids claiming `ON_SERVER` without evidence, and `P5` says the honest
     * answer to "what do you know?" when the answer is "nothing" is to say
     * nothing rather than to pick a default.
     */
    private currentClaim: SyncHonestyClaim = null;
    private lastSyncedAt?: Date;
    private listeners: Set<StatusListener> = new Set();
    private dexieSubscription?: Subscription;
    private unsubscribeFromUnqueueable?: () => void;
    /**
     * Counts binds, so a read started under one can be discarded if the farmer
     * changed while it was in flight. Publishing a late reading of a database
     * the app has since left is the cross-user leak this whole change removes.
     */
    private bindGeneration = 0;
    /**
     * The most recent reading, kept because the claim now has TWO independent
     * inputs — Dexie, and an in-memory registry the save path writes — and
     * either can move without the other.
     */
    private evidence: SyncEvidenceSnapshot = EMPTY_SYNC_EVIDENCE;

    private constructor() {
        this.initializeObserver();
    }

    static getInstance(): SyncStatusService {
        if (!SyncStatusService.instance) {
            SyncStatusService.instance = new SyncStatusService();
        }
        return SyncStatusService.instance;
    }

    private initializeObserver() {
        this.observeActiveDatabase();

        // A `liveQuery` re-fires only when a Dexie table it READ changes. A
        // skipped log writes to none of them — no mutation row, no outbox row,
        // nothing — so without this subscription the chip would sit on its
        // stale `पाठवलं ✓` until some unrelated queue write happened to wake the
        // query up. The one moment the app holds this fact is the save that
        // dropped the record, and this is how that moment reaches the chip.
        this.unsubscribeFromUnqueueable = subscribeToUnqueueableLogs(unqueueableCount => {
            this.evidence = { ...this.evidence, unqueueableCount };
            this.republish(this.lastSyncedAt);
        });

        // A farmer signing in on this handset moves the app to THEIR database
        // (`activateUserDatabase.ts`). This subscription is the one in the app
        // that outlives that move: it is a process-wide singleton, never torn
        // down, and a `liveQuery` observes the database it was built on. Left
        // alone it would go on reporting the PREVIOUS farmer's queue to the new
        // one — a cross-user leak into the most prominent control on the
        // screen, and a stale one, since closing that handle also stops it
        // ever updating again.
        onActiveDatabaseChanged(() => this.rebindToActiveDatabase());
    }

    /** Observe the queues of whichever database is active right now. */
    private observeActiveDatabase() {
        // Observe the MUTATION QUEUE — the only store with a server-ack
        // contract — plus the upload and AI-job queues the badge already counts.
        // `db.outbox` is deliberately not read: nothing sends it, so it can only
        // ever report a permanently-latched "sending".
        const observable = liveQuery(() => readSyncEvidence());
        const generation = ++this.bindGeneration;
        let caughtUp = false;

        this.dexieSubscription = observable.subscribe(
            ({ evidence, lastSyncedAt }) => {
                this.evidence = evidence;
                this.republish(lastSyncedAt);

                if (!caughtUp) {
                    caughtUp = true;
                    void this.catchUpOnWritesMissedWhileBinding(generation);
                }
            },
            error => console.error('Error observing sync status:', error)
        );
    }

    /**
     * Read once more, immediately after the subscription's first reading.
     *
     * SUBSCRIBING IS NOT THE SAME MOMENT AS LISTENING. `liveQuery` does not
     * begin watching for writes when you subscribe to it: it registers its
     * change listener only once its FIRST query has come back
     * (`dexie@4.3.0`, `liveQuery` — the listener is attached in the resolve
     * handler, just before the value is delivered). Between those two moments
     * nothing is listening, and a write that commits inside the gap fires its
     * notification into an empty room. Dexie does not replay it; the chip then
     * sits on a claim one write out of date until some LATER, unrelated write
     * happens to wake the query.
     *
     * That gap is not theoretical and not small. It spans building and opening
     * the database — twenty-two schema versions — which is tens of milliseconds
     * on an idle machine and was MEASURED at ~220ms while the app was busy. It
     * is widest exactly where it hurts most: the instant a second farmer signs
     * in, when the database being opened is brand new, and when the first thing
     * the app does is start syncing that farmer's queue.
     *
     * Measured, not argued: with the gap open, a write landing 2–46ms after a
     * switch of farmer NEVER reached the chip, while a second write immediately
     * afterwards always did. One dropped signal, and a chip that reports the
     * queue as it was before the farmer's own record went into it — the same
     * silence about a stranded record that this service exists to break.
     *
     * So the first reading is taken TWICE. The second read is issued from the
     * first EMISSION, which `liveQuery` delivers only after it has started
     * listening, so this read's snapshot is strictly newer than the moment the
     * gap closed. A write before that moment is caught here; a write after it is
     * caught by the subscription. Nothing can fall between them.
     *
     * It costs one extra pass over four queues, once per bind — at start-up and
     * at each change of farmer, never per write.
     */
    private async catchUpOnWritesMissedWhileBinding(generation: number): Promise<void> {
        try {
            const { evidence, lastSyncedAt } = await readSyncEvidence();

            // Another farmer signed in while this read was in flight. The rows
            // it just counted belong to a database the app has left, and the
            // bind that replaced this one is already reading the right one.
            if (generation !== this.bindGeneration) {
                return;
            }

            this.evidence = evidence;
            this.republish(lastSyncedAt);
        } catch (err) {
            // Same case as the guard above, arriving as a throw instead of a
            // value: a farmer signing in mid-read makes `getDatabase()` close
            // the handle this read was using, and Dexie rejects it. That is the
            // switch working, not a fault, and reporting it as one would put a
            // false alarm in the console of every device that changes farmer.
            if (generation !== this.bindGeneration) {
                return;
            }
            console.error('Error re-reading sync status after binding:', err);
        }
    }

    /**
     * Re-point the chip at the farmer who just signed in.
     *
     * Evidence resets to EMPTY rather than carrying over, because every part of
     * it was a fact about someone else's records. `EMPTY_SYNC_EVIDENCE` derives
     * to `null` — NO CLAIM — which is the honest state for a device that has
     * not yet read this farmer's queue (`P5`), and is what `republish` will
     * publish until the first reading of the new database arrives.
     *
     * The session-scoped unqueueable registry is cleared for the same reason:
     * every id in it names a log in a database this farmer cannot see.
     */
    private rebindToActiveDatabase() {
        this.dexieSubscription?.unsubscribe();
        this.dexieSubscription = undefined;

        this.evidence = EMPTY_SYNC_EVIDENCE;
        this.republish(undefined);
        resetUnqueueableLogs();

        this.observeActiveDatabase();
    }

    /** Re-derives the claim from the current evidence and publishes any change. */
    private republish(lastSyncedAt?: Date) {
        const newClaim = deriveSyncHonestyState(this.evidence);
        const nextSyncedAtMs = lastSyncedAt?.getTime();
        const currentSyncedAtMs = this.lastSyncedAt?.getTime();

        if (newClaim === this.currentClaim && nextSyncedAtMs === currentSyncedAtMs) {
            return;
        }

        this.currentClaim = newClaim;
        // Mirrored from the sync cursor, never minted here.
        this.lastSyncedAt = lastSyncedAt;
        this.notifyListeners();
    }

    public subscribe(listener: StatusListener): () => void {
        this.listeners.add(listener);
        // Immediately invoke with current state
        listener(this.currentClaim, this.lastSyncedAt);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners() {
        for (const listener of this.listeners) {
            try {
                listener(this.currentClaim, this.lastSyncedAt);
            } catch (err) {
                console.error('Error in sync status listener:', err);
            }
        }
    }

    /** The current claim, or `null` for "we have nothing to report". */
    public getStatus(): SyncHonestyClaim {
        return this.currentClaim;
    }
}
