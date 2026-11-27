/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P3) - the hook the setup screens read: the farm's setup as this phone knows it
 * (`getLocalFarmSetup`), for ONE farm - the farm open in the app (`FarmContext`, the one source of the open farm since repair FIX-1). Live: it follows the
 * pull (the v33 stores) and the outbox (a change queued, sent, answered or refused) by itself. `null` while it is first read, or when no farm is open.
 * A NEW farm id starts again from `null` in the same render: one farm's set is never shown on another farm.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getLocalFarmSetup, type LocalFarmSetup } from './farmSetupLocal';

const notReceived = (farmId: string): LocalFarmSetup => ({
    farmId, received: false, waterSources: [], machines: [], powerTimes: null, plotWater: new Map(), waitingCount: 0, refused: [], farmPlotIds: new Set(),
});

/** No IndexedDB on this platform (never on a phone; a test runner without one): nothing can have been received - said at once, never "still reading". */
const noStore = (): boolean => typeof indexedDB === 'undefined';
const firstValue = (farmId: string | null): LocalFarmSetup | null => (farmId && noStore() ? notReceived(farmId) : null);

export function useFarmSetup(farmId: string | null | undefined): LocalFarmSetup | null {
    const [state, setState] = useState<{ farmId: string | null; value: LocalFarmSetup | null }>(() => ({ farmId: farmId ?? null, value: firstValue(farmId ?? null) }));
    if (state.farmId !== (farmId ?? null)) setState({ farmId: farmId ?? null, value: firstValue(farmId ?? null) });

    useEffect(() => {
        if (!farmId || noStore()) return;
        let alive = true;
        let unsubscribe: (() => void) | undefined;
        try {
            const sub = liveQuery(() => getLocalFarmSetup(getDatabase(), farmId)).subscribe({
                next: value => { if (alive) setState({ farmId, value }); },
                // the phone's store cannot be read: "not received" - the phone-only page as before, never a blank page
                error: () => { if (alive) setState({ farmId, value: notReceived(farmId) }); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setState({ farmId, value: notReceived(farmId) });
        }
        return () => { alive = false; unsubscribe?.(); };
    }, [farmId]);

    return state.farmId === (farmId ?? null) ? state.value : null;
}
