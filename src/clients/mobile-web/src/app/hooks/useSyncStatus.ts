import { useState, useEffect } from 'react';
import { SyncStatusService } from '../../infrastructure/storage/SyncStatusService';
import type { SyncHonestyClaim } from '../../features/sync/status/syncHonestyState';

export function useSyncStatus() {
    // Starts at NO CLAIM — see SyncStatusService.currentClaim. The service
    // replays its current value on subscribe, so this is only ever the value
    // for the first render.
    const [claim, setClaim] = useState<SyncHonestyClaim>(null);
    const [lastSyncedAt, setLastSyncedAt] = useState<Date | undefined>();

    useEffect(() => {
        const service = SyncStatusService.getInstance();

        const unsubscribe = service.subscribe((newClaim, newLastSyncedAt) => {
            setClaim(newClaim);
            setLastSyncedAt(newLastSyncedAt);
        });

        return () => {
            unsubscribe();
        };
    }, []);

    return {
        /**
         * A claim, or `null` for "we have nothing to report".
         *
         * There is no non-null projection any more. T1 shipped one as an
         * explicit stopgap so `AppHeader` kept compiling while the UI gate was
         * stale, and marked it DELETE THIS; both consumers now handle `null` by
         * rendering no chip at all, which is what `P5` asked for in the first
         * place. Do not reintroduce a default — every default is a claim, and
         * the whole point of this value is that sometimes we have none.
         */
        claim,
        lastSyncedAt,
    };
}
