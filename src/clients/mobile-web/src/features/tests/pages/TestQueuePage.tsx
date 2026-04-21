/**
 * TestQueuePage — CEI Phase 2 §4.5.
 *
 * Design intent:
 *   - Offline-first. Reads all `testInstances` Dexie rows for the active farm
 *     on mount, then refreshes per-cycle from the server in the background.
 *   - Bands: Overdue (rose) → Due (amber) → Collected (stone) → Reported (emerald,
 *     collapsed by default).
 *   - Filter chips: Due / Overdue / Reported / All (default = Overdue).
 *   - Optional URL params:
 *       ?plotId=<guid>        — pre-filter rows to a single plot
 *       ?cropCycleId=<guid>   — pre-filter rows to a single cycle
 *       ?filter=Due|Overdue|Reported|All
 *       ?action=collect|record — auto-open the appropriate sheet for the
 *                                first row matching that action bucket
 *   - FAB: "+ New protocol" visible only for Agronomist / Consultant.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getDatabase, type DexieTestInstance, type DexieTestProtocol } from '../../../infrastructure/storage/DexieDatabase';
import { TestInstanceStatus } from '../../../domain/tests/TestInstance';
import { useFarmContext } from '../../../core/session/FarmContext';
import TestInstanceCard from '../components/TestInstanceCard';
import MarkCollectedSheet from '../components/MarkCollectedSheet';
import RecordResultSheet from '../components/RecordResultSheet';
import { getTestQueue } from '../data/testsClient';
import type { AppRoute } from '../../../domain/types/farm.types';

interface TestQueuePageProps {
    onNavigate?: (route: AppRoute) => void;
}

type Filter = 'All' | 'Due' | 'Overdue' | 'Reported';

const parseQuery = (): { plotId?: string; cropCycleId?: string; filter?: Filter; action?: 'collect' | 'record'; instanceId?: string } => {
    if (typeof window === 'undefined') return {};
    const p = new URLSearchParams(window.location.search);
    const filterRaw = p.get('filter');
    const filter: Filter | undefined =
        filterRaw === 'All' || filterRaw === 'Due' || filterRaw === 'Overdue' || filterRaw === 'Reported'
            ? filterRaw
            : undefined;
    const actionRaw = p.get('action');
    const action: 'collect' | 'record' | undefined =
        actionRaw === 'collect' || actionRaw === 'record' ? actionRaw : undefined;
    return {
        plotId: p.get('plotId') || undefined,
        cropCycleId: p.get('cropCycleId') || undefined,
        filter,
        action,
        instanceId: p.get('instanceId') || undefined,
    };
};

const TestQueuePage: React.FC<TestQueuePageProps> = ({ onNavigate }) => {
    const { currentFarmId, currentFarm } = useFarmContext();
    const [instances, setInstances] = useState<DexieTestInstance[]>([]);
    const [protocols, setProtocols] = useState<Record<string, DexieTestProtocol>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

    const initial = useMemo(parseQuery, []);
    const [filter, setFilter] = useState<Filter>(initial.filter ?? 'Overdue');

    const [activeAction, setActiveAction] = useState<{
        instance: DexieTestInstance;
        kind: 'collect' | 'record' | 'view';
    } | null>(null);

    const hydrateFromDexie = useCallback(async () => {
        if (!currentFarmId) return;
        const db = getDatabase();
        const rows = await db.testInstances.where('farmId').equals(currentFarmId).toArray();
        setInstances(rows);
        const protoList = await db.testProtocols.toArray();
        const protoMap: Record<string, DexieTestProtocol> = {};
        for (const p of protoList) protoMap[p.id] = p;
        setProtocols(protoMap);
    }, [currentFarmId]);

    const refreshFromServer = useCallback(async () => {
        if (!currentFarmId) return;
        const db = getDatabase();
        // Fan out per cached crop cycle on this farm.
        const cycles = await db.cropCycles.where('farmId').equals(currentFarmId).toArray();
        if (cycles.length === 0) {
            setLastRefreshedAt(new Date().toISOString());
            return;
        }
        const fetched: DexieTestInstance[] = [];
        await Promise.allSettled(
            cycles.map(async c => {
                try {
                    const list = await getTestQueue(c.id);
                    fetched.push(...list);
                } catch {
                    /* one cycle's failure doesn't sink the page */
                }
            }),
        );
        if (fetched.length > 0) {
            await db.testInstances.bulkPut(fetched);
        }
        await hydrateFromDexie();
        setLastRefreshedAt(new Date().toISOString());
    }, [currentFarmId, hydrateFromDexie]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            await hydrateFromDexie();
            if (!cancelled) setIsLoading(false);
            if (!cancelled) await refreshFromServer();
        })();
        return () => { cancelled = true; };
    }, [hydrateFromDexie, refreshFromServer]);

    // Auto-open sheet if ?action= was provided.
    useEffect(() => {
        if (!initial.action || instances.length === 0) return;
        if (activeAction) return;
        let target: DexieTestInstance | undefined;
        if (initial.instanceId) {
            target = instances.find(i => i.id === initial.instanceId);
        }
        if (!target) {
            if (initial.action === 'collect') {
                target = instances.find(i => i.status === TestInstanceStatus.Due || i.status === TestInstanceStatus.Overdue);
            } else if (initial.action === 'record') {
                target = instances.find(i => i.status === TestInstanceStatus.Collected);
            }
        }
        if (target) setActiveAction({ instance: target, kind: initial.action });
    }, [initial.action, initial.instanceId, instances, activeAction]);

    // Apply plot / cycle URL filters first, then the status-band filter.
    const scoped = useMemo(() => {
        let rows = instances;
        if (initial.plotId) rows = rows.filter(i => i.plotId === initial.plotId);
        if (initial.cropCycleId) rows = rows.filter(i => i.cropCycleId === initial.cropCycleId);
        return rows;
    }, [instances, initial.plotId, initial.cropCycleId]);

    const buckets = useMemo(() => {
        const due = scoped.filter(i => i.status === TestInstanceStatus.Due);
        const overdue = scoped.filter(i => i.status === TestInstanceStatus.Overdue);
        const collected = scoped.filter(i => i.status === TestInstanceStatus.Collected);
        const reported = scoped.filter(i => i.status === TestInstanceStatus.Reported);
        return { due, overdue, collected, reported };
    }, [scoped]);

    const visibleByFilter = useMemo(() => {
        if (filter === 'Due') return { ...buckets, overdue: [], collected: [], reported: [] };
        if (filter === 'Overdue') return { ...buckets, due: [], collected: [], reported: [] };
        if (filter === 'Reported') return { due: [], overdue: [], collected: [], reported: buckets.reported };
        return buckets;
    }, [buckets, filter]);

    const openSheetForInstance = (instance: DexieTestInstance) => {
        if (instance.status === TestInstanceStatus.Due || instance.status === TestInstanceStatus.Overdue) {
            setActiveAction({ instance, kind: 'collect' });
            return;
        }
        if (instance.status === TestInstanceStatus.Collected) {
            setActiveAction({ instance, kind: 'record' });
            return;
        }
        if (instance.status === TestInstanceStatus.Reported) {
            if (typeof window !== 'undefined') {
                window.history.pushState({}, '', `/tests/${instance.id}`);
                onNavigate?.('test-detail' as AppRoute);
            }
        }
    };

    const canCreateProtocol = (() => {
        const role = currentFarm?.role ?? '';
        return role === 'Agronomist' || role === 'Consultant';
    })();

    const asOfLabel = lastRefreshedAt
        ? new Date(lastRefreshedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '';

    if (isLoading && instances.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-stone-400 text-sm">
                    Loading...
                </p>
            </div>
        );
    }

    const totalVisible =
        visibleByFilter.due.length +
        visibleByFilter.overdue.length +
        visibleByFilter.collected.length +
        visibleByFilter.reported.length;

    return (
        <div className="flex flex-col min-h-full bg-stone-50 pb-28">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-stone-100 px-4 py-3">
                <div className="flex items-baseline justify-between">
                    <h1
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-xl font-bold text-stone-800"
                    >
                        Tests
                    </h1>
                    {asOfLabel && (
                        <span
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400"
                        >
                            as of {asOfLabel}
                        </span>
                    )}
                </div>
                <p
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                    className="text-sm text-stone-500 mt-0.5"
                >
                    चाचण्या
                </p>
                {(initial.plotId || initial.cropCycleId) && (
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700"
                    >
                        Filtered {initial.plotId ? '· plot' : ''}{initial.cropCycleId ? '· cycle' : ''}
                    </p>
                )}
            </div>

            {/* Filter chips */}
            <div className="px-4 py-3 flex gap-2 overflow-x-auto">
                {(['Overdue', 'Due', 'Reported', 'All'] as Filter[]).map(f => {
                    const active = filter === f;
                    return (
                        <button
                            key={f}
                            type="button"
                            onClick={() => setFilter(f)}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold border transition-colors ${
                                active
                                    ? 'bg-stone-900 text-white border-stone-900'
                                    : 'bg-white text-stone-600 border-stone-200 active:bg-stone-100'
                            }`}
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {f}
                        </button>
                    );
                })}
            </div>

            {totalVisible === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16">
                    <div className="text-4xl">🧪</div>
                    <p
                        style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        className="text-center text-base font-medium text-stone-600"
                    >
                        आज कोणत्याही चाचण्या नाहीत
                    </p>
                    <p
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                        className="text-center text-sm text-stone-400"
                    >
                        No tests pending today
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-4 px-4 py-2">
                    {/* Overdue band (rose) */}
                    {visibleByFilter.overdue.length > 0 && (
                        <Band
                            label="Overdue"
                            labelMr="उशीर"
                            tone="rose"
                            items={visibleByFilter.overdue}
                            protocols={protocols}
                            onCardAction={openSheetForInstance}
                        />
                    )}

                    {/* Due band (amber) */}
                    {visibleByFilter.due.length > 0 && (
                        <Band
                            label="Due"
                            labelMr="बाकी"
                            tone="amber"
                            items={visibleByFilter.due}
                            protocols={protocols}
                            onCardAction={openSheetForInstance}
                        />
                    )}

                    {/* Collected band (stone) */}
                    {visibleByFilter.collected.length > 0 && (
                        <Band
                            label="Collected"
                            labelMr="घेतले"
                            tone="stone"
                            items={visibleByFilter.collected}
                            protocols={protocols}
                            onCardAction={openSheetForInstance}
                        />
                    )}

                    {/* Reported band (emerald, collapsed by default) */}
                    {visibleByFilter.reported.length > 0 && (
                        <CollapsibleBand
                            label="Reported"
                            labelMr="अहवाल दिला"
                            tone="emerald"
                            items={visibleByFilter.reported}
                            protocols={protocols}
                            onCardAction={openSheetForInstance}
                        />
                    )}
                </div>
            )}

            {/* FAB — new protocol (Agronomist / Consultant only) */}
            {canCreateProtocol && (
                <button
                    type="button"
                    onClick={() => { /* routed to protocol-authoring in a follow-up task */ }}
                    className="fixed z-40 flex items-center gap-2 rounded-full bg-emerald-600 text-white font-bold text-sm shadow-lg shadow-emerald-900/20 px-4 py-3 active:bg-emerald-700"
                    style={{
                        bottom: 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
                        right: '1rem',
                        fontFamily: "'DM Sans', sans-serif",
                    }}
                >
                    <span>+ New protocol</span>
                </button>
            )}

            {/* Sheets */}
            {activeAction?.kind === 'collect' && (
                <MarkCollectedSheet
                    instance={activeAction.instance}
                    onClose={() => setActiveAction(null)}
                    onSuccess={async () => {
                        setActiveAction(null);
                        await hydrateFromDexie();
                        await refreshFromServer();
                    }}
                />
            )}
            {activeAction?.kind === 'record' && (
                <RecordResultSheet
                    instance={activeAction.instance}
                    protocol={protocols[activeAction.instance.testProtocolId]}
                    onClose={() => setActiveAction(null)}
                    onSuccess={async () => {
                        setActiveAction(null);
                        await hydrateFromDexie();
                        await refreshFromServer();
                    }}
                />
            )}
        </div>
    );
};

interface BandProps {
    label: string;
    labelMr: string;
    tone: 'rose' | 'amber' | 'stone' | 'emerald';
    items: DexieTestInstance[];
    protocols: Record<string, DexieTestProtocol>;
    onCardAction: (instance: DexieTestInstance) => void;
}

const toneTextColor: Record<BandProps['tone'], string> = {
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    stone: 'text-stone-500',
    emerald: 'text-emerald-600',
};

const Band: React.FC<BandProps> = ({ label, labelMr, tone, items, protocols, onCardAction }) => (
    <div>
        <h2
            style={{ fontFamily: "'DM Sans', sans-serif" }}
            className={`text-xs font-bold uppercase tracking-wide mb-2 ${toneTextColor[tone]}`}
        >
            {label} <span className="font-normal opacity-60" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>· {labelMr}</span>
        </h2>
        <div className="flex flex-col gap-3">
            {items.map(instance => (
                <TestInstanceCard
                    key={instance.id}
                    instance={instance}
                    protocol={protocols[instance.testProtocolId]}
                    onAction={onCardAction}
                    onOpen={onCardAction}
                />
            ))}
        </div>
    </div>
);

const CollapsibleBand: React.FC<BandProps> = (props) => {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-left"
            >
                <h2
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className={`text-xs font-bold uppercase tracking-wide ${toneTextColor[props.tone]}`}
                >
                    {props.label} <span className="font-normal opacity-60" style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}>· {props.labelMr}</span>
                </h2>
                <span className="text-[11px] text-emerald-700 font-bold">
                    {props.items.length} · {open ? 'Hide' : 'Show'}
                </span>
            </button>
            {open && (
                <div className="mt-2 flex flex-col gap-3">
                    {props.items.map(instance => (
                        <TestInstanceCard
                            key={instance.id}
                            instance={instance}
                            protocol={props.protocols[instance.testProtocolId]}
                            onOpen={props.onCardAction}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TestQueuePage;
