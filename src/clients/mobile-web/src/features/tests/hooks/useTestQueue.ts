/**
 * useTestQueue — offline-first hook powering TestQueuePage.
 *
 * Hydrates from Dexie first (so the page always renders something on open,
 * even offline), then refreshes from `GET /shramsafal/test-instances?cropCycleId=`
 * on mount. On refresh success, the Dexie cache is updated so future opens
 * are warm.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    getDatabase,
    type DexieTestInstance,
} from '../../../infrastructure/storage/DexieDatabase';
import { getTestQueue } from '../data/testsClient';

interface UseTestQueueResult {
    instances: DexieTestInstance[];
    isLoading: boolean;
    /** True while a server refresh is in flight (Dexie hydration done). */
    isRefreshing: boolean;
    /** Latest error from server refresh, if any. Dexie-only renders ignore this. */
    error: string | null;
    refetch: () => Promise<void>;
}

export function useTestQueue(cropCycleId: string | null | undefined): UseTestQueueResult {
    const [instances, setInstances] = useState<DexieTestInstance[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!cropCycleId) {
            setInstances([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);

        // 1) Dexie hydrate first (never blocks on network).
        try {
            const db = getDatabase();
            const cached = await db.testInstances
                .where('cropCycleId')
                .equals(cropCycleId)
                .toArray();
            setInstances(cached);
        } catch {
            /* cache miss is fine; server will populate */
        } finally {
            setIsLoading(false);
        }

        // 2) Server refresh in the background.
        setIsRefreshing(true);
        try {
            const fresh = await getTestQueue(cropCycleId);
            setInstances(fresh);
            // persist for offline
            try {
                const db = getDatabase();
                await db.testInstances.bulkPut(fresh);
            } catch {
                /* swallow cache write failures */
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh tests');
        } finally {
            setIsRefreshing(false);
        }
    }, [cropCycleId]);

    useEffect(() => { void load(); }, [load]);

    return { instances, isLoading, isRefreshing, error, refetch: load };
}
