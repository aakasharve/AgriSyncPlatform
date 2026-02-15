import { liveQuery, Subscription } from 'dexie';
import { getDatabase } from './DexieDatabase';

export type GlobalSyncStatus = 'SAVED' | 'PENDING' | 'SYNCED' | 'CONFLICT';

type StatusListener = (status: GlobalSyncStatus, lastSyncedAt?: Date) => void;

export class SyncStatusService {
    private static instance: SyncStatusService;
    private currentStatus: GlobalSyncStatus = 'SYNCED';
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
        const db = getDatabase();

        // Observe Outbox Table
        const observable = liveQuery(async () => {
            const pendingCount = await db.outbox.where('status').equals('PENDING').count();
            const sendingCount = await db.outbox.where('status').equals('SENDING').count();
            const failedCount = await db.outbox.where('status').equals('FAILED').count();

            return { pendingCount, sendingCount, failedCount };
        });

        this.dexieSubscription = observable.subscribe(
            ({ pendingCount, sendingCount, failedCount }) => {
                let newStatus: GlobalSyncStatus;

                if (failedCount > 0) {
                    newStatus = 'CONFLICT';
                } else if (pendingCount > 0 || sendingCount > 0) {
                    newStatus = 'PENDING';
                } else {
                    newStatus = 'SYNCED';
                }

                if (newStatus !== this.currentStatus) {
                    this.currentStatus = newStatus;
                    if (newStatus === 'SYNCED') {
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

    public getStatus(): GlobalSyncStatus {
        return this.currentStatus;
    }
}
