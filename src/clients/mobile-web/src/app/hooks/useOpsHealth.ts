import { useCallback, useEffect, useRef, useState } from 'react';
import { agriSyncClient, AdminOpsHealthDto } from '../../infrastructure/api/AgriSyncClient';

export interface UseOpsHealthState {
    data: AdminOpsHealthDto | null;
    isLoading: boolean;
    forbidden: boolean;
    error: string | null;
    refreshedAt: string | null;
    refresh: () => Promise<void>;
}

function getStatusCode(error: unknown): number | null {
    const e = error as { response?: { status?: unknown } };
    return typeof e?.response?.status === 'number' ? e.response.status : null;
}

export function useOpsHealth(autoRefreshMs = 30_000): UseOpsHealthState {
    const [data, setData] = useState<AdminOpsHealthDto | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const result = await agriSyncClient.getAdminOpsHealth();
            setData(result);
            setRefreshedAt(new Date().toISOString());
            setForbidden(false);
        } catch (err) {
            const status = getStatusCode(err);
            if (status === 403) {
                setForbidden(true);
            } else {
                setError('Failed to load ops health data.');
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        await load();
    }, [load]);

    useEffect(() => {
        void load();
        if (autoRefreshMs > 0) {
            intervalRef.current = setInterval(() => { void load(); }, autoRefreshMs);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [load, autoRefreshMs]);

    return { data, isLoading, forbidden, error, refreshedAt, refresh };
}
