import React from 'react';
import { AiDashboardResponse } from '../../../infrastructure/api/AgriSyncClient';

interface AiRecentFailuresTableProps {
    recentJobs: AiDashboardResponse['recentJobs'];
}

function formatDate(value?: string): string {
    if (!value) {
        return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleString();
}

export const AiRecentFailuresTable: React.FC<AiRecentFailuresTableProps> = ({ recentJobs }) => {
    const rows = recentJobs
        .filter(job => job.status === 'Failed' || job.status === 'FallbackSucceeded')
        .slice(0, 20);

    return (
        <section className="glass-panel p-5 space-y-3">
            <div>
                <h2 className="text-lg font-bold text-stone-800">Recent Failures And Fallbacks</h2>
                <p className="text-xs text-stone-500">
                    Latest jobs where primary provider failed or full request failed.
                </p>
            </div>

            {rows.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-white px-3 py-4 text-sm text-stone-600">
                    No recent failures or fallback events in the dashboard window.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                    <table className="min-w-full text-sm">
                        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                            <tr>
                                <th className="px-3 py-2">Job</th>
                                <th className="px-3 py-2">Operation</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2">Providers</th>
                                <th className="px-3 py-2">Created</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(job => (
                                <tr key={job.id} className="border-t border-stone-100 text-stone-700">
                                    <td className="px-3 py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                                    <td className="px-3 py-2">{job.operationType}</td>
                                    <td className="px-3 py-2">
                                        <span
                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                                job.status === 'Failed'
                                                    ? 'bg-rose-100 text-rose-700'
                                                    : 'bg-amber-100 text-amber-800'
                                            }`}
                                        >
                                            {job.status}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">{job.providers.join(' -> ')}</td>
                                    <td className="px-3 py-2">{formatDate(job.createdAtUtc)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

