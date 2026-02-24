import React, { useMemo } from 'react';
import {
    AiDashboardResponse,
    AiHealthResponse,
} from '../../../infrastructure/api/AgriSyncClient';

interface AiProviderHealthPanelProps {
    health: AiHealthResponse | null;
    dashboard: AiDashboardResponse | null;
    refreshedAtUtc: string | null;
}

interface ProviderRow {
    provider: string;
    isHealthy: boolean;
    successes: number;
    failures: number;
}

export const AiProviderHealthPanel: React.FC<AiProviderHealthPanelProps> = ({
    health,
    dashboard,
    refreshedAtUtc,
}) => {
    const rows = useMemo<ProviderRow[]>(() => {
        const healthByProvider = new Map<string, boolean>();
        for (const status of health?.statuses ?? []) {
            healthByProvider.set(status.provider, status.isHealthy);
        }

        const providers = new Set<string>([
            ...(health?.statuses ?? []).map(x => x.provider),
            ...Object.keys(dashboard?.successes ?? {}),
            ...Object.keys(dashboard?.failures ?? {}),
        ]);

        return Array.from(providers)
            .sort((a, b) => a.localeCompare(b))
            .map(provider => ({
                provider,
                isHealthy: healthByProvider.get(provider) ?? false,
                successes: dashboard?.successes?.[provider] ?? 0,
                failures: dashboard?.failures?.[provider] ?? 0,
            }));
    }, [dashboard, health]);

    const fallbackCount = useMemo(() => {
        return (dashboard?.recentJobs ?? []).filter(job => job.status === 'FallbackSucceeded').length;
    }, [dashboard]);

    return (
        <section className="glass-panel p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-stone-800">Provider Health</h2>
                    <p className="text-xs text-stone-500">
                        7-day success/failure rollup with live health check status.
                    </p>
                </div>
                <div className="text-right text-xs text-stone-500">
                    <div>Fallbacks (recent): {fallbackCount}</div>
                    {dashboard?.sinceUtc && (
                        <div>Stats since: {new Date(dashboard.sinceUtc).toLocaleString()}</div>
                    )}
                    {refreshedAtUtc && (
                        <div>Refreshed: {new Date(refreshedAtUtc).toLocaleTimeString()}</div>
                    )}
                </div>
            </div>

            {rows.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-white px-3 py-4 text-sm text-stone-600">
                    No provider telemetry is available yet.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {rows.map(row => {
                        const total = row.successes + row.failures;
                        const successRate = total > 0 ? Math.round((row.successes / total) * 100) : 0;
                        return (
                            <div
                                key={row.provider}
                                className="rounded-lg border border-stone-200 bg-white px-4 py-3 space-y-2"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="font-semibold text-stone-800">{row.provider}</span>
                                    <span
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                            row.isHealthy
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-rose-100 text-rose-700'
                                        }`}
                                    >
                                        <span className="h-2 w-2 rounded-full bg-current" />
                                        {row.isHealthy ? 'Healthy' : 'Unhealthy'}
                                    </span>
                                </div>
                                <div className="text-sm text-stone-600">
                                    <div>Successes: {row.successes}</div>
                                    <div>Failures: {row.failures}</div>
                                    <div>Success rate: {successRate}%</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

