import { useState, useEffect } from 'react';
import { SyncStatusService, type SyncHonestyState } from '../../infrastructure/storage/SyncStatusService';

export function useSyncStatus() {
    // Starts at the lesser claim — see SyncStatusService.currentStatus. The
    // service replays its current value on subscribe, so this initial value is
    // only ever visible for the first render.
    const [status, setStatus] = useState<SyncHonestyState>('ON_PHONE');
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
