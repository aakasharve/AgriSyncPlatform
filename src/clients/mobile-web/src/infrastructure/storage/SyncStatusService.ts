import { liveQuery, Subscription } from 'dexie';
import { getDatabase } from './DexieDatabase';
import {
    deriveSyncHonestyState,
    SYNC_HONESTY_OPEN_STATUSES,
    type SyncEvidenceSnapshot,
    type SyncHonestyClaim,
    type SyncHonestyState,
} from '../../features/sync/status/syncHonestyState';

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
        // Observe the MUTATION QUEUE — the only store with a server-ack
        // contract — plus the upload and AI-job queues the badge already counts.
        // `db.outbox` is deliberately not read: nothing sends it, so it can only
        // ever report a permanently-latched "sending".
        const observable = liveQuery(() => readSyncEvidence());

        this.dexieSubscription = observable.subscribe(
            ({ evidence, lastSyncedAt }) => {
                const newClaim = deriveSyncHonestyState(evidence);
                const nextSyncedAtMs = lastSyncedAt?.getTime();
                const currentSyncedAtMs = this.lastSyncedAt?.getTime();

                if (newClaim === this.currentClaim && nextSyncedAtMs === currentSyncedAtMs) {
                    return;
                }

                this.currentClaim = newClaim;
                // Mirrored from the sync cursor, never minted here.
                this.lastSyncedAt = lastSyncedAt;
                this.notifyListeners();
            },
            error => console.error('Error observing sync status:', error)
        );
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
