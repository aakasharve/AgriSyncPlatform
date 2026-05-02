/**
 * DEV-ONLY — renders AdminOpsPage with realistic mock data.
 * Access: http://localhost:3000?preview=ops-admin
 * No backend, no auth required.
 */
import React from 'react';
import { AdminOpsHealthDto } from '../../../infrastructure/api/AgriSyncClient';

const MOCK: AdminOpsHealthDto = {
    voiceInvocations24h: 247,
    voiceFailures24h: 12,
    voiceFailureRatePct: 4.9,
    voiceAvgLatencyMs: 1240,
    voiceP95LatencyMs: 3870,
    recentErrors: [
        {
            eventType: 'api.error',
            endpoint: 'POST /shramsafal/logs',
            statusCode: 500,
            latencyMs: 340,
            farmId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            occurredAtUtc: new Date(Date.now() - 12 * 60000).toISOString(),
        },
        {
            eventType: 'client.error',
            endpoint: '/shramsafal/sync/push',
            statusCode: 503,
            latencyMs: 8200,
            farmId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            occurredAtUtc: new Date(Date.now() - 28 * 60000).toISOString(),
        },
        {
            eventType: 'api.slow',
            endpoint: 'POST /shramsafal/ai/parse-voice',
            statusCode: 200,
            latencyMs: 5100,
            farmId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
            occurredAtUtc: new Date(Date.now() - 55 * 60000).toISOString(),
        },
    ],
    topSufferingFarms: [
        {
            farmId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            errorCount: 9,
            syncErrors: 5,
            logErrors: 3,
            voiceErrors: 1,
            lastErrorAt: new Date(Date.now() - 28 * 60000).toISOString(),
        },
        {
            farmId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            errorCount: 4,
            syncErrors: 0,
            logErrors: 4,
            voiceErrors: 0,
            lastErrorAt: new Date(Date.now() - 12 * 60000).toISOString(),
        },
    ],
    apiErrorSpike: false,
    voiceDegraded: false,
    computedAtUtc: new Date().toISOString(),
};

// Patch useOpsHealth to return mock data in preview mode
// We render AdminOpsPage's UI directly with the mock injected via module-level override.
export const AdminOpsPreview: React.FC = () => {
    return (
        <div className="min-h-screen bg-stone-50 p-4">
            <div className="max-w-2xl mx-auto">
                <div className="mb-4 px-3 py-2 bg-amber-100 border border-amber-300 rounded-xl text-xs font-bold text-amber-800">
                    🔧 DEV PREVIEW — mock data, no backend needed. Remove <code>?preview=ops-admin</code> to exit.
                </div>
                <MockAdminOpsContent />
            </div>
        </div>
    );
};

// Inline the page content with mock data (avoids hook dependency on real API)
const MockAdminOpsContent: React.FC = () => {
    const data = MOCK;

    return (
        <div className="space-y-4 pb-24">
            {/* Header */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-stone-800 flex items-center gap-2">
                            <span className="text-emerald-600">⚡</span> Ops Health
                        </h1>
                        <p className="text-sm text-stone-400 mt-0.5">Live · auto-refreshes every 30s</p>
                    </div>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full">
                        Mock data
                    </span>
                </div>
            </div>

            {/* Alert badges */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3">Alert Status</p>
                <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                        ✓ R9 API Spike — OK
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                        ✓ R10 Voice — OK
                    </span>
                </div>
            </div>

            {/* Voice stats */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3">🎤 Voice Pipeline — last 24h</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                        { label: 'Invocations', value: data.voiceInvocations24h, hl: '' },
                        { label: 'Failure Rate', value: `${data.voiceFailureRatePct}%`, sub: `${data.voiceFailures24h} failures`, hl: 'green' },
                        { label: 'Avg Latency', value: `${data.voiceAvgLatencyMs}ms`, hl: 'green' },
                        { label: 'P95 Latency', value: `${data.voiceP95LatencyMs}ms`, hl: 'amber' },
                    ].map(s => (
                        <div key={s.label} className={`rounded-xl border-l-4 p-4 ${
                            s.hl === 'green' ? 'border-l-emerald-400 bg-emerald-50/40 border border-stone-100'
                            : s.hl === 'amber' ? 'border-l-amber-400 bg-amber-50/40 border border-stone-100'
                            : 'border-l-stone-200 bg-white border border-stone-100'
                        }`}>
                            <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">{s.label}</p>
                            <p className="text-2xl font-black text-stone-800 mt-1">{s.value}</p>
                            {s.sub && <p className="text-xs text-stone-400 mt-0.5">{s.sub}</p>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent errors */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">🔴 Recent Errors — last 2h</p>
                <div>
                    {data.recentErrors.map((e, i) => (
                        <div key={i} className="flex items-start gap-3 py-2.5 border-b border-stone-50 last:border-0">
                            <div className={`mt-0.5 text-lg flex-shrink-0`}>
                                {e.eventType === 'api.error' ? '💥' : e.eventType === 'client.error' ? '📱' : '🐢'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-mono text-stone-700 truncate">{e.endpoint}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {e.statusCode && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                            (e.statusCode ?? 0) >= 500 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'
                                        }`}>{e.statusCode}</span>
                                    )}
                                    {e.latencyMs && <span className="text-[10px] text-stone-400">{e.latencyMs}ms</span>}
                                    <span className="text-[10px] text-stone-300">
                                        {new Date(e.occurredAtUtc).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Farmer suffering */}
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">👥 Farmer Suffering — last 24h</p>
                <div>
                    {data.topSufferingFarms.map((f, i) => (
                        <div key={f.farmId} className="flex items-center gap-3 py-2.5 border-b border-stone-50 last:border-0">
                            <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-black flex-shrink-0">
                                {i + 1}
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
                    ))}
                </div>
            </div>
        </div>
    );
};
