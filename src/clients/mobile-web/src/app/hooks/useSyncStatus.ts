import { useState, useEffect } from 'react';
import { SyncStatusService } from '../../infrastructure/storage/SyncStatusService';
import type { SyncHonestyClaim, SyncHonestyState } from '../../features/sync/status/syncHonestyState';

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
         * The truthful value: a claim, or `null` for "we have nothing to
         * report". Render NOTHING when this is null. New callers use this.
         */
        claim,
        /**
         * INTERIM, non-null projection for `SyncIndicator`, which cannot yet
         * render an absent claim — that needs a `.tsx` edit and this round is
         * `.ts`-only (the UI/UX gate token is stale while HEAD moves).
         *
         * `null` falls back to the WEAKEST claim, never the strongest: a device
         * with nothing to report is described as "on the phone", which
         * understates delivery and can never fabricate a receipt. It is wrong
         * in the safe direction, and it is strictly better than the
         * `ON_SERVER` this code shipped before review round 1.
         *
         * DELETE THIS the moment `AppHeader` handles `claim === null` by
         * hiding the chip.
         */
        status: (claim ?? 'ON_PHONE') satisfies SyncHonestyState,
        lastSyncedAt,
    };
}
