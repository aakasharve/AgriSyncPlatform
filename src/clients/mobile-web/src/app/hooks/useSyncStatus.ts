import { useState, useEffect } from 'react';
import { SyncStatusService, GlobalSyncStatus } from '../../infrastructure/storage/SyncStatusService';

export function useSyncStatus() {
    const [status, setStatus] = useState<GlobalSyncStatus>('SYNCED');
    const [lastSyncedAt, setLastSyncedAt] = useState<Date | undefined>();

    useEffect(() => {
        const service = SyncStatusService.getInstance();

        const unsubscribe = service.subscribe((newStatus, newLastSyncedAt) => {
            setStatus(newStatus);
            setLastSyncedAt(newLastSyncedAt);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    return { status, lastSyncedAt };
}
