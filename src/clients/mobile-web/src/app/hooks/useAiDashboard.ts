import { useCallback, useEffect, useState } from 'react';
import {
    agriSyncClient,
    AiDashboardResponse,
    AiHealthResponse,
    AiProviderConfigResponse,
    UpdateAiProviderConfigRequest,
} from '../../infrastructure/api/AgriSyncClient';

function getStatusCode(error: unknown): number | null {
    const value = error as { response?: { status?: unknown } };
    return typeof value?.response?.status === 'number' ? value.response.status : null;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    return 'Failed to load AI operations data.';
}

export interface UseAiDashboardState {
    config: AiProviderConfigResponse | null;
    health: AiHealthResponse | null;
    dashboard: AiDashboardResponse | null;
    isLoading: boolean;
    isSaving: boolean;
    forbidden: boolean;
    error: string | null;
    refreshedAtUtc: string | null;
    refresh: () => Promise<void>;
    saveConfig: (request: UpdateAiProviderConfigRequest) => Promise<void>;
}

export function useAiDashboard(): UseAiDashboardState {
    const [config, setConfig] = useState<AiProviderConfigResponse | null>(null);
    const [health, setHealth] = useState<AiHealthResponse | null>(null);
    const [dashboard, setDashboard] = useState<AiDashboardResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [forbidden, setForbidden] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshedAtUtc, setRefreshedAtUtc] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setError(null);
        const [nextConfig, nextHealth, nextDashboard] = await Promise.all([
            agriSyncClient.getAiProviderConfig(),
            agriSyncClient.getAiHealth(),
            agriSyncClient.getAiDashboard(),
        ]);

        setConfig(nextConfig);
        setHealth(nextHealth);
        setDashboard(nextDashboard);
        setRefreshedAtUtc(new Date().toISOString());
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setForbidden(false);
        try {
            await loadData();
        } catch (loadError) {
            const status = getStatusCode(loadError);
            if (status === 403) {
                setForbidden(true);
                setError(null);
            } else {
                setError(getErrorMessage(loadError));
            }
        } finally {
            setIsLoading(false);
        }
    }, [loadData]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const saveConfig = useCallback(async (request: UpdateAiProviderConfigRequest) => {
        setIsSaving(true);
        try {
            const updated = await agriSyncClient.updateAiProviderConfig(request);
            setConfig(updated);
            await refresh();
        } finally {
            setIsSaving(false);
        }
    }, [refresh]);

    return {
        config,
        health,
        dashboard,
        isLoading,
        isSaving,
        forbidden,
        error,
        refreshedAtUtc,
        refresh,
        saveConfig,
    };
}
