import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { VISIBLE_BUCKET_IDS, visibleBucketLabels, type VisibleBucketId } from '../../../domain/ai/BucketId';
import type { CorrectionEvent } from '../../../domain/ai/contracts/CorrectionEvent';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

interface BucketCorrectionSummary {
    bucketId: VisibleBucketId;
    count: number;
    latestAt?: string;
    latestPromptVersion?: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function summarizeCorrections(events: CorrectionEvent[]): BucketCorrectionSummary[] {
    const summaries = new Map<VisibleBucketId, BucketCorrectionSummary>();
    for (const bucketId of VISIBLE_BUCKET_IDS) {
        summaries.set(bucketId, { bucketId, count: 0 });
    }

    for (const event of events) {
        if (!event.bucketId) continue;
        const summary = summaries.get(event.bucketId);
        if (!summary) continue;

        summary.count += 1;
        if (!summary.latestAt || Date.parse(event.timestamp) > Date.parse(summary.latestAt)) {
            summary.latestAt = event.timestamp;
            summary.latestPromptVersion = event.promptVersion;
        }
    }

    return Array.from(summaries.values())
        .sort((a, b) => b.count - a.count || visibleBucketLabels[a.bucketId].localeCompare(visibleBucketLabels[b.bucketId]));
}

const formatTimestamp = (iso?: string): string => {
    if (!iso) return 'No edits';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export const AiBucketCorrectionPanel: React.FC = () => {
    const [events, setEvents] = useState<CorrectionEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const fromIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
            const records = await getDatabase()
                .aiCorrectionEvents
                .where('timestamp')
                .aboveOrEqual(fromIso)
                .toArray();
            setEvents(records);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load correction events.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadEvents();
    }, [loadEvents]);

    const summaries = useMemo(() => summarizeCorrections(events), [events]);
    const totalCorrections = events.length;

    return (
        <div className="glass-panel p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-stone-800">Bucket Correction Signals</h2>
                    <p className="text-sm text-stone-500">
                        Local farmer edits from the last 7 days, grouped by visible bucket.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void loadEvents()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-bold text-stone-700 disabled:opacity-60"
                >
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                    {error}
                </div>
            )}

            <div className="mb-4 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                <div className="text-2xl font-black text-stone-900">{totalCorrections}</div>
                <div className="text-xs font-bold uppercase text-stone-500">Total saved corrections</div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {summaries.map(summary => {
                    const active = summary.count > 0;
                    return (
                        <div
                            key={summary.bucketId}
                            className={`rounded-xl border px-4 py-3 ${
                                active
                                    ? 'border-amber-200 bg-amber-50'
                                    : 'border-stone-100 bg-white'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-black text-stone-800">
                                        {visibleBucketLabels[summary.bucketId]}
                                    </div>
                                    <div className="mt-1 text-[11px] font-semibold text-stone-500">
                                        {formatTimestamp(summary.latestAt)}
                                    </div>
                                </div>
                                <div className={`rounded-full px-2.5 py-1 text-xs font-black ${
                                    active ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'
                                }`}>
                                    {summary.count}
                                </div>
                            </div>
                            {summary.latestPromptVersion && (
                                <div className="mt-2 truncate text-[10px] font-semibold text-stone-400">
                                    {summary.latestPromptVersion}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
