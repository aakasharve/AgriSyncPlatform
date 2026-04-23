import React from 'react';
import {
    Activity, AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink,
    Mic, RefreshCw, ServerCrash, ShieldAlert, Users, XCircle,
} from 'lucide-react';
import { useOpsHealth } from '../../../app/hooks/useOpsHealth';
import { OpsErrorEventDto, OpsFarmErrorDto } from '../../../infrastructure/api/AgriSyncClient';

interface AdminOpsPageProps {
    onBack: () => void;
}

// ---- Helpers ----

function AlertBadge({ breached, label }: { breached: boolean | null; label: string }) {
    if (breached === null) {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-400 bg-stone-100 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                {label} — pending
            </span>
        );
    }
    return breached ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full animate-pulse">
            <AlertTriangle size={12} />
            {label} BREACHED
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
            <CheckCircle2 size={12} />
            {label} — OK
        </span>
    );
}

function StatCard({ label, value, sub, highlight }: {
    label: string; value: string | number; sub?: string; highlight?: 'red' | 'amber' | 'green';
}) {
    const accent = highlight === 'red'
        ? 'border-l-red-400 bg-red-50/40'
        : highlight === 'amber'
            ? 'border-l-amber-400 bg-amber-50/40'
            : highlight === 'green'
                ? 'border-l-emerald-400 bg-emerald-50/40'
                : 'border-l-stone-200 bg-white';

    return (
        <div className={`rounded-xl border border-stone-100 border-l-4 ${accent} p-4`}>
            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-black text-stone-800 mt-1">{value}</p>
            {sub && <p className="text-xs text-stone-400 mt-0.5">{sub}</p>}
        </div>
    );
}

function ErrorRow({ e }: { e: OpsErrorEventDto }) {
    const isError = e.eventType === 'api.error';
    const isClient = e.eventType === 'client.error';
    return (
        <div className="flex items-start gap-3 py-2.5 border-b border-stone-50 last:border-0">
            <div className={`mt-0.5 flex-shrink-0 ${isError ? 'text-red-400' : isClient ? 'text-amber-400' : 'text-blue-400'}`}>
                {isError ? <ServerCrash size={14} /> : isClient ? <ShieldAlert size={14} /> : <Activity size={14} />}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-stone-700 truncate">{e.endpoint}</p>
                <div className="flex items-center gap-2 mt-0.5">
                    {e.statusCode && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            (e.statusCode ?? 0) >= 500 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                        }`}>{e.statusCode}</span>
                    )}
                    {e.latencyMs && (
                        <span className="text-[10px] text-stone-400">{e.latencyMs}ms</span>
                    )}
                    <span className="text-[10px] text-stone-300">
                        {new Date(e.occurredAtUtc).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
            </div>
        </div>
    );
}

function FarmRow({ f, idx }: { f: OpsFarmErrorDto; idx: number }) {
    return (
        <div className="flex items-center gap-3 py-2.5 border-b border-stone-50 last:border-0">
            <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-black flex-shrink-0">
                {idx + 1}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-stone-600 truncate">{f.farmId.slice(0, 8)}…</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {f.syncErrors > 0 && <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 rounded">sync ×{f.syncErrors}</span>}
                    {f.logErrors > 0 && <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 rounded">log ×{f.logErrors}</span>}
                    {f.voiceErrors > 0 && <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-1.5 rounded">voice ×{f.voiceErrors}</span>}
                </div>
            </div>
            <span className="text-sm font-black text-red-500 flex-shrink-0">{f.errorCount}</span>
        </div>
    );
}

// ---- Main page ----

export const AdminOpsPage: React.FC<AdminOpsPageProps> = ({ onBack }) => {
    const { data, isLoading, forbidden, error, refreshedAt, refresh } = useOpsHealth(30_000);

    const voiceHighlight = data
        ? data.voiceFailureRatePct >= 20 ? 'red'
            : data.voiceFailureRatePct >= 10 ? 'amber'
                : 'green'
        : undefined;

    return (
        <div className="space-y-4 pb-24">
            {/* Deprecation banner (T-W0B-03) — this embedded ops surface is preserved
                for on-the-go checks, but the real tool is the desktop admin console. */}
            <div className="rounded-xl border-l-4 border-amber-400 bg-amber-50/70 p-3 flex items-start gap-2.5">
                <ExternalLink size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 text-sm">
                    <p className="font-semibold text-amber-900">
                        Open the full admin console on desktop
                    </p>
                    <p className="text-xs text-amber-800/80 mt-0.5">
                        This phone view shows live health only. For dense tables, keyboard-driven
                        filtering and multi-org switching, use{' '}
                        <a
                            href="https://admin.shramsafal.in"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold underline hover:text-amber-700"
                        >
                            admin.shramsafal.in
                        </a>{' '}
                        on a laptop.
                    </p>
                </div>
            </div>

            {/* Header */}
            <div className="glass-panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
                            <Activity size={20} className="text-emerald-600" />
                            Ops Health
                        </h1>
                        <p className="text-sm text-stone-500 mt-0.5">
                            Live · auto-refreshes every 30s
                            {refreshedAt && (
                                <span className="text-stone-400 ml-2">
                                    · Last: {new Date(refreshedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onBack}
                            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 flex items-center gap-1.5">
                            <ArrowLeft size={14} /> Back
                        </button>
                        <button onClick={() => void refresh()} disabled={isLoading}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-1.5">
                            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                            {isLoading ? 'Loading…' : 'Refresh'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Forbidden — user has no admin membership OR no OpsLive module.
                W0-B: admin is resolved server-side from ssf.organization_memberships. */}
            {forbidden && (
                <div className="glass-panel p-6 text-center">
                    <XCircle size={32} className="mx-auto text-red-400 mb-2" />
                    <p className="font-bold text-stone-700">Admin access required</p>
                    <p className="text-sm text-stone-400 mt-1">
                        Your account does not have an admin membership. Ask a Platform owner to invite
                        you via the admin console.
                    </p>
                </div>
            )}

            {/* Error */}
            {error && !forbidden && (
                <div className="glass-panel p-4 flex items-center gap-3 border-l-4 border-red-400">
                    <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {!forbidden && data && (
                <>
                    {/* Alert breaches */}
                    <div className="glass-panel p-4">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3">Alert Status</p>
                        <div className="flex flex-wrap gap-2">
                            <AlertBadge breached={data.apiErrorSpike} label="R9 API Spike" />
                            <AlertBadge breached={data.voiceDegraded} label="R10 Voice" />
                        </div>
                        {(data.apiErrorSpike === null || data.voiceDegraded === null) && (
                            <p className="text-[10px] text-stone-300 mt-2">
                                "pending" = Ops Phase 2 views not yet deployed. Deploy to activate.
                            </p>
                        )}
                    </div>

                    {/* Voice/AI stats */}
                    <div className="glass-panel p-4">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                            <Mic size={12} /> Voice Pipeline — last 24h
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <StatCard label="Invocations" value={data.voiceInvocations24h} />
                            <StatCard
                                label="Failure Rate"
                                value={`${data.voiceFailureRatePct}%`}
                                sub={`${data.voiceFailures24h} failures`}
                                highlight={voiceHighlight}
                            />
                            <StatCard
                                label="Avg Latency"
                                value={`${Math.round(data.voiceAvgLatencyMs)}ms`}
                                highlight={data.voiceAvgLatencyMs > 3000 ? 'amber' : 'green'}
                            />
                            <StatCard
                                label="P95 Latency"
                                value={`${Math.round(data.voiceP95LatencyMs)}ms`}
                                highlight={data.voiceP95LatencyMs > 5000 ? 'red' : data.voiceP95LatencyMs > 3000 ? 'amber' : 'green'}
                            />
                        </div>
                    </div>

                    {/* Recent errors */}
                    <div className="glass-panel p-4">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <ServerCrash size={12} /> Recent Errors — last 2h
                        </p>
                        {data.recentErrors.length === 0 ? (
                            <div className="py-6 text-center">
                                <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-1" />
                                <p className="text-sm text-stone-400">
                                    {data.voiceInvocations24h === 0
                                        ? 'No error events yet — deploy Ops Phase 1 middleware to start tracking.'
                                        : 'No errors in the last 2 hours.'}
                                </p>
                            </div>
                        ) : (
                            <div>
                                {data.recentErrors.map((e, i) => <ErrorRow key={i} e={e} />)}
                            </div>
                        )}
                    </div>

                    {/* Farmer suffering */}
                    <div className="glass-panel p-4">
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <Users size={12} /> Farmer Suffering — last 24h
                        </p>
                        {data.topSufferingFarms.length === 0 ? (
                            <div className="py-6 text-center">
                                <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-1" />
                                <p className="text-sm text-stone-400">No farms with repeated errors.</p>
                            </div>
                        ) : (
                            <div>
                                {data.topSufferingFarms.map((f, i) => <FarmRow key={f.farmId} f={f} idx={i} />)}
                            </div>
                        )}
                    </div>
                </>
            )}

            {!forbidden && !data && !isLoading && !error && (
                <div className="glass-panel p-8 text-center">
                    <p className="text-stone-400 text-sm">No data available.</p>
                </div>
            )}
        </div>
    );
};
