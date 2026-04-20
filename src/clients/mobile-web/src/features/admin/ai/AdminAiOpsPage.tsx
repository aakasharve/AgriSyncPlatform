import React, { useCallback } from 'react';
import {
    UpdateAiProviderConfigRequest,
} from '../../../infrastructure/api/AgriSyncClient';
import { useAiDashboard } from '../../../app/hooks/useAiDashboard';
import { AiProviderConfigForm } from './AiProviderConfigForm';
import { AiProviderHealthPanel } from './AiProviderHealthPanel';
import { AiRecentFailuresTable } from './AiRecentFailuresTable';

interface AdminAiOpsPageProps {
    onBack: () => void;
}

export const AdminAiOpsPage: React.FC<AdminAiOpsPageProps> = ({ onBack }) => {
    const {
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
    } = useAiDashboard();

    const handleSave = useCallback(async (request: UpdateAiProviderConfigRequest) => {
        await saveConfig(request);
    }, [saveConfig]);

    return (
        <div className="space-y-4 pb-24">
            <div className="glass-panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-stone-800">AI Operations</h1>
                        <p className="text-sm text-stone-500">
                            Admin controls for provider routing, fallback policy, and live health.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onBack}
                            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                void refresh();
                            }}
                            disabled={isLoading || isSaving}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                            {isLoading ? 'Refreshing...' : 'Refresh'}
                        </button>
                    </div>
                </div>
            </div>

            {forbidden && (
                <div className="glass-panel p-5">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Admin role is required for this page.
                    </div>
                </div>
            )}

            {!forbidden && error && (
                <div className="glass-panel p-5">
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                    </div>
                </div>
            )}

            {!forbidden && config && (
                <AiProviderConfigForm
                    config={config}
                    isSaving={isSaving}
                    onSave={handleSave}
                />
            )}

            {!forbidden && (
                <AiProviderHealthPanel
                    health={health}
                    dashboard={dashboard}
                    refreshedAtUtc={refreshedAtUtc}
                />
            )}

            {!forbidden && dashboard && (
                <AiRecentFailuresTable recentJobs={dashboard.recentJobs} />
            )}
        </div>
    );
};
