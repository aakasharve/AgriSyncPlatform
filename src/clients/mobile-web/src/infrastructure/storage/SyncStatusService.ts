import { liveQuery, Subscription } from 'dexie';
import { getDatabase } from './DexieDatabase';
import {
    deriveSyncHonestyState,
    SYNC_HONESTY_OPEN_STATUSES,
    type SyncHonestyState,
    type SyncQueueRowSnapshot,
} from '../../features/sync/status/syncHonestyState';

export type { SyncHonestyState };

type StatusListener = (status: SyncHonestyState, lastSyncedAt?: Date) => void;

/**
 * Reads the mutation-queue rows the chip's claim depends on.
 *
 * Labour Phase 2 / T1: this used to read `db.outbox`, a table nothing drains,
 * which is why the chip claimed "Sending..." forever. `db.mutationQueue` is
 * the only store carrying a real per-mutation server acknowledgement
 * (`BackgroundSyncWorker.ts:224-226`). `db.outbox` still has all of its
 * writers — this task only removed it from the status READ path (`R1`).
 *
 * Exported so the repoint is directly testable: the singleton below owns a
 * process-wide `liveQuery` subscription that is never torn down, so tests must
 * not have to construct it.
 */
export async function readSyncQueueSnapshot(): Promise<SyncQueueRowSnapshot[]> {
    const db = getDatabase();

    const rows = await db.mutationQueue
        .where('status')
        .anyOf(...SYNC_HONESTY_OPEN_STATUSES)
        .toArray();

    // Project down to the two fields the derivation needs. The chip has no
    // business retaining whole mutation payloads for the lifetime of a
    // never-unsubscribed liveQuery.
    return rows.map(row => ({ status: row.status, retryCount: row.retryCount }));
}

export class SyncStatusService {
    private static instance: SyncStatusService;
    /**
     * Starts at the LESSER claim. Before the first query resolves we have no
     * evidence that anything reached the server, and `R5` forbids claiming
     * `ON_SERVER` without it. "On the phone" understates progress at worst;
     * it can never over-claim.
     */
    private currentStatus: SyncHonestyState = 'ON_PHONE';
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
        // contract. `db.outbox` is deliberately not read: nothing sends it, so
        // it can only ever report a permanently-latched "sending".
        const observable = liveQuery(() => readSyncQueueSnapshot());

        this.dexieSubscription = observable.subscribe(
            rows => {
                const newStatus = deriveSyncHonestyState(rows);

                if (newStatus !== this.currentStatus) {
                    this.currentStatus = newStatus;
                    if (newStatus === 'ON_SERVER') {
                        this.lastSyncedAt = new Date();
                    }
                    this.notifyListeners();
                }
            },
            error => console.error('Error observing sync status:', error)
        );
    }

    public subscribe(listener: StatusListener): () => void {
        this.listeners.add(listener);
        // Immediately invoke with current state
        listener(this.currentStatus, this.lastSyncedAt);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners() {
        for (const listener of this.listeners) {
            try {
                listener(this.currentStatus, this.lastSyncedAt);
            } catch (err) {
                console.error('Error in sync status listener:', err);
            }
        }
    }

    public getStatus(): SyncHonestyState {
        return this.currentStatus;
    }
}
