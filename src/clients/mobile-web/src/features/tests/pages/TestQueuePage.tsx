/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — चाचण्या, route 'tests', in the
 * founder-approved look (PLR-D9 `PlacePages.TestsPage`) over the REAL tests. It was English ("Tests", "Overdue /
 * Due / Reported / All", "No tests pending today", "+ New protocol", "as of …", "Label · मराठी" bands). Every
 * real part is kept (CEI Phase 2 §4.5):
 *   - offline-first: the farm's `testInstances` from this phone first, then a per-crop-cycle refresh from the
 *     server in the background (one cycle's failure does not sink the page);
 *   - groups by state, in `testView.ts` words: वेळ उलटून गेली → करायची आहे → नमुना घेतला → निकाल आला (the
 *     last folded by default, as the "Reported" band was — open when that filter is picked);
 *   - the filters सर्व / वेळ उलटून गेली / करायची आहे / निकाल आला, default सर्व (TASK 15 D1, founder: a farm
 *     with only Due tests must not open on an empty Overdue list and a false "no tests" line);
 *   - each card's one button: नमुना घेतला (confirm sheet → `markCollected`), निकाल नोंदवा (result sheet →
 *     `recordResult`), निकाल पहा (the test's own page, `/tests/{id}` + 'test-detail');
 *   - URL params, unchanged: ?plotId= ?cropCycleId= (scope to one plot / cycle, now said in words),
 *     ?filter=All|Due|Overdue|Reported, ?action=collect|record (+ ?instanceId=) to open a sheet at once
 *     (once — closing it used to reopen it straight away; and with ?instanceId= only THAT test, never a
 *     stand-in — see the effect below);
 *   - when the list was last refreshed — stamped ONLY when at least one server call answered (review B002).
 *     No crop cycle on the phone → nothing was asked, and the page says why; some cycles failed → the time
 *     AND a line that some plots are this phone's older copy; all failed → this phone's copy, said so.
 *     "आज कोणत्याही चाचण्या नाहीत" is said only when every cycle's list came back empty from the server;
 *     an empty phone that could not ask says "या फोनवर एकही चाचणी नाही." instead;
 *   - "+ New protocol" (Agronomist / Consultant only) was a button that did nothing: it is now a plain
 *     "लवकरच" line for those roles (P5).
 * `onBack` (the bar's मागे) and `onTell` (the "सांगा" button) are drawn only when the route passes them.
 * Plot names come from this phone's copy of the farm's plots; test, stage and parameter names come from the
 * server as they are.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { getDatabase, type DexieTestInstance, type DexieTestProtocol } from '../../../infrastructure/storage/DexieDatabase';
import { TestInstanceStatus } from '../../../domain/tests/TestInstance';
import { useFarmContext } from '../../../core/session/FarmContext';
import { settleWithin } from '../data/phoneWait';
import TestInstanceCard from '../components/TestInstanceCard';
import MarkCollectedSheet from '../components/MarkCollectedSheet';
import RecordResultSheet from '../components/RecordResultSheet';
import { getTestQueue } from '../data/testsClient';
import type { AppRoute } from '../../../domain/types/farm.types';
import { formatFarmerTime } from '../../../shared/utils/displayTime';
import { BigButton, Chip, ChoiceChips, PageBar, SANS, SectionHead, Soon, Tap } from '../../../shared/components/ui/placeUi';
import {
    FILTER_ITEMS, GROUP_ORDER, STATE_VIEW, TESTS_EMPTY, TESTS_EXPLAINER, TESTS_TITLE,
    groupTests, isTestFilter, plotNamesFrom, type GroupKey, type TestFilter,
} from '../components/testView';

interface TestQueuePageProps {
    onNavigate?: (route: AppRoute) => void;
    /** The title bar's मागे. Not drawn when absent. */
    onBack?: () => void;
    /** Opens the voice / typed log flow ("नमुना घेतला / निकाल आला — सांगा"). Not drawn when absent. */
    onTell?: () => void;
}

/**
 * What the last refresh managed (review B002). 'pending' until the first one settles;
 * 'reached' = every crop cycle answered; 'partial' = some did; 'failed' = none did;
 * 'no-cycles' = the phone has no crop cycle for this farm, so nothing could be asked;
 * 'no-farm' = no farm is chosen, so there is nothing to ask about (review N2: it used to stay 'pending',
 * and an empty page said it was fetching, for ever).
 */
type RefreshOutcome = 'pending' | 'reached' | 'partial' | 'failed' | 'no-cycles' | 'no-farm';

const REFRESH_NOTE: Record<Exclude<RefreshOutcome, 'pending' | 'reached'>, string> = {
    partial: 'काही प्लॉटची माहिती आणता आली नाही — त्यांची या फोनवरची जुनी माहिती दाखवत आहोत.',
    failed: 'आत्ता ताजी माहिती आणता आली नाही — या फोनवर साठवलेली दाखवत आहोत.',
    'no-cycles': 'या फोनवर अजून या शेतातल्या पिकांची माहिती आलेली नाही, म्हणून सर्व्हरवरून चाचण्या आणता आल्या नाहीत.',
    'no-farm': 'आधी शेत निवडा — मग इथे त्या शेताच्या चाचण्या दिसतील.',
};

const parseQuery = (): { plotId?: string; cropCycleId?: string; filter?: TestFilter; action?: 'collect' | 'record'; instanceId?: string } => {
    if (typeof window === 'undefined') return {};
    const p = new URLSearchParams(window.location.search);
    const filterRaw = p.get('filter');
    const actionRaw = p.get('action');
    const action: 'collect' | 'record' | undefined =
        actionRaw === 'collect' || actionRaw === 'record' ? actionRaw : undefined;
    return {
        plotId: p.get('plotId') || undefined,
        cropCycleId: p.get('cropCycleId') || undefined,
        filter: isTestFilter(filterRaw) ? filterRaw : undefined,
        action,
        instanceId: p.get('instanceId') || undefined,
    };
};

const TestQueuePage: React.FC<TestQueuePageProps> = ({ onNavigate, onBack, onTell }) => {
    const { currentFarmId, currentFarm } = useFarmContext();
    const [instances, setInstances] = useState<DexieTestInstance[]>([]);
    const [protocols, setProtocols] = useState<Record<string, DexieTestProtocol>>({});
    const [plotNames, setPlotNames] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    /** Set ONLY when at least one server call answered (review B002). */
    const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
    const [refreshOutcome, setRefreshOutcome] = useState<RefreshOutcome>('pending');
    const [actionNote, setActionNote] = useState<'missing' | 'moved-on' | null>(null);

    const initial = useMemo(parseQuery, []);
    // Task 15, D1 — was 'Overdue'. See this file's header for why.
    const [filter, setFilter] = useState<TestFilter>(initial.filter ?? 'All');
    const [reportedOpen, setReportedOpen] = useState(false);

    const [activeAction, setActiveAction] = useState<{
        instance: DexieTestInstance;
        kind: 'collect' | 'record';
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
        try {
            setPlotNames(plotNamesFrom(await db.plots.where('farmId').equals(currentFarmId).toArray()));
        } catch {
            /* no plot names: the cards say the stage and the date without one */
        }
    }, [currentFarmId]);

    const refreshFromServer = useCallback(async () => {
        if (!currentFarmId) {
            setRefreshOutcome('no-farm');
            return;
        }
        try {
            const db = getDatabase();
            // Fan out per cached crop cycle on this farm. Tests are asked for per cycle, so with no cycle on
            // the phone nothing is asked at all — and nothing may claim a refresh happened (review B002).
            const cycles = await db.cropCycles.where('farmId').equals(currentFarmId).toArray();
            if (cycles.length === 0) {
                setRefreshOutcome('no-cycles');
                return;
            }
            const fetched: DexieTestInstance[] = [];
            let reached = 0;
            await Promise.allSettled(
                cycles.map(async c => {
                    try {
                        const list = await getTestQueue(c.id);
                        fetched.push(...list);
                        reached += 1;
                    } catch {
                        /* one cycle's failure doesn't sink the page */
                    }
                }),
            );
            if (fetched.length > 0) {
                await db.testInstances.bulkPut(fetched);
            }
            await hydrateFromDexie();
            // Only a refresh that reached the server may say when the list was refreshed.
            if (reached > 0) setLastRefreshedAt(new Date().toISOString());
            setRefreshOutcome(reached === 0 ? 'failed' : reached < cycles.length ? 'partial' : 'reached');
        } catch (error) {
            console.error('[tests] could not refresh the test list', { farmId: currentFarmId, error });
            setRefreshOutcome('failed');
        }
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

    // Auto-open sheet if ?action= was provided — ONCE. Without the latch, closing that sheet set
    // `activeAction` back to null, this effect ran again and opened it again: it could not be closed.
    //
    // With ?instanceId= it opens THAT test or nothing. It used to fall back to the first Due/Overdue
    // (or Collected) test on the phone, so confirming would have recorded the wrong test. A named test
    // that is not here once the server refresh has settled is said so; one whose state no longer fits
    // the action (e.g. `collect` on a test already collected) is not opened — the server would refuse it.
    const autoOpened = useRef(false);
    useEffect(() => {
        const action = initial.action;
        if (!action || activeAction || autoOpened.current) return;
        const fits = (i: DexieTestInstance) => (action === 'collect'
            ? i.status === TestInstanceStatus.Due || i.status === TestInstanceStatus.Overdue
            : i.status === TestInstanceStatus.Collected);
        if (initial.instanceId) {
            const target = instances.find(i => i.id === initial.instanceId);
            if (!target) {
                if (refreshOutcome !== 'pending') {
                    autoOpened.current = true;
                    setActionNote('missing');
                }
                return;
            }
            autoOpened.current = true;
            if (fits(target)) setActiveAction({ instance: target, kind: action });
            else setActionNote('moved-on');
            return;
        }
        const target = instances.find(fits);
        if (target) {
            autoOpened.current = true;
            setActiveAction({ instance: target, kind: action });
        }
    }, [initial.action, initial.instanceId, instances, activeAction, refreshOutcome]);

    // Apply plot / cycle URL filters first, then the state filter.
    const scoped = useMemo(() => {
        let rows = instances;
        if (initial.plotId) rows = rows.filter(i => i.plotId === initial.plotId);
        if (initial.cropCycleId) rows = rows.filter(i => i.cropCycleId === initial.cropCycleId);
        return rows;
    }, [instances, initial.plotId, initial.cropCycleId]);

    const groups = useMemo(() => groupTests(scoped, filter), [scoped, filter]);
    const allGroups = useMemo(() => groupTests(scoped, 'All'), [scoped]);
    const totalVisible = GROUP_ORDER.reduce((n, k) => n + groups[k].length, 0);
    // Nothing at all → the true "no tests" sentence; something hidden by the filter → say so instead.
    const totalScoped = GROUP_ORDER.reduce((n, k) => n + allGroups[k].length, 0);

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

    const afterSave = async () => {
        setActiveAction(null);
        await hydrateFromDexie();
        await refreshFromServer();
    };

    // Closing a sheet without saving also re-asks the server, in the background. A sheet that was refused
    // because the test had already moved on tells the farmer "हे बंद करा — यादी ताजी होईल": this is what
    // makes that true.
    const closeSheet = () => {
        setActiveAction(null);
        void refreshFromServer();
    };

    const canCreateProtocol = (() => {
        const role = currentFarm?.role ?? '';
        return role === 'Agronomist' || role === 'Consultant';
    })();

    const asOfLabel = lastRefreshedAt ? formatFarmerTime(lastRefreshedAt) : '';
    const scopedPlotName = initial.plotId ? plotNames[initial.plotId] : undefined;

    const renderGroup = (key: GroupKey) => {
        const list = groups[key];
        if (list.length === 0) return null;
        const view = STATE_VIEW[key];
        const cards = list.map(instance => (
            <TestInstanceCard
                key={instance.id}
                instance={instance}
                protocol={protocols[instance.testProtocolId]}
                plotName={plotNames[instance.plotId]}
                onAction={openSheetForInstance}
            />
        ));
        // Results fold away under "सर्व" (they were a collapsed band); picking "निकाल आला" shows them open.
        if (key === 'reported' && filter !== 'Reported') {
            return (
                <div key={key} className="space-y-2" data-testid="tests-reported">
                    <Tap onClick={() => setReportedOpen(o => !o)} aria-expanded={reportedOpen} data-testid="tests-reported-toggle"
                        className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-2xl bg-white px-3 text-left ring-1 ring-emerald-200">
                        <span className="text-[17px] font-extrabold text-stone-900">{view.label}</span>
                        <span className="flex items-center gap-2 text-[14px] font-extrabold text-emerald-800">
                            <Chip tone="green">{list.length}</Chip>{reportedOpen ? 'लपवा' : 'दाखवा'}
                        </span>
                    </Tap>
                    {reportedOpen && cards}
                </div>
            );
        }
        return (
            <div key={key} className="space-y-2" data-testid={`tests-${key}`}>
                <SectionHead title={view.label} hint={view.hint} />
                {cards}
            </div>
        );
    };

    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6" style={{ fontFamily: SANS }} data-testid="tests-page">
            <PageBar title={TESTS_TITLE} onBack={onBack} />

            {isLoading && instances.length === 0 ? (
                <p className="m-0 p-6 text-center text-[15px] font-bold text-stone-500" data-testid="tests-loading">चाचण्या आणत आहे…</p>
            ) : (
                <div className="space-y-3">
                    <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">{TESTS_EXPLAINER}</p>

                    {(initial.plotId || initial.cropCycleId) && (
                        <div className="flex flex-wrap gap-1.5 px-1" data-testid="tests-scope">
                            {initial.plotId && <Chip tone="green">फक्त या प्लॉटच्या चाचण्या{scopedPlotName ? ` — ${scopedPlotName}` : ''}</Chip>}
                            {initial.cropCycleId && <Chip tone="green">फक्त या पीक-हंगामाच्या चाचण्या</Chip>}
                        </div>
                    )}

                    {asOfLabel && (
                        <p className="m-0 px-1 text-[12.5px] font-semibold text-stone-500" data-testid="tests-refreshed">माहिती ताजी केली: {asOfLabel}</p>
                    )}
                    {refreshOutcome !== 'pending' && refreshOutcome !== 'reached' && (
                        <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid={`tests-refresh-${refreshOutcome}`}>
                            {REFRESH_NOTE[refreshOutcome]}
                        </p>
                    )}
                    {actionNote && (
                        <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid="tests-action-note">
                            {actionNote === 'missing'
                                ? 'उघडायला सांगितलेली चाचणी या फोनवर सापडली नाही.'
                                : 'उघडायला सांगितलेली चाचणी आधीच पुढच्या टप्प्यावर गेली आहे — खालच्या यादीत पाहा.'}
                        </p>
                    )}

                    <ChoiceChips items={FILTER_ITEMS} value={filter} onPick={setFilter} testId="tests-filter" />

                    {totalVisible === 0 ? (
                        totalScoped === 0 ? (
                            // "No tests" is said only when every crop cycle's list came back from the server.
                            refreshOutcome === 'reached' ? (
                                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[15px] font-bold text-stone-600" data-testid="tests-empty">{TESTS_EMPTY}</p>
                            ) : refreshOutcome === 'pending' ? (
                                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[15px] font-bold text-stone-500" data-testid="tests-empty-pending">सर्व्हरवरून चाचण्या आणत आहे…</p>
                            ) : (
                                <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[15px] font-bold text-stone-600" data-testid="tests-empty-phone">या फोनवर एकही चाचणी नाही.</p>
                            )
                        ) : (
                            <p className="m-0 rounded-2xl bg-white/70 p-4 text-center text-[15px] font-bold text-stone-600" data-testid="tests-empty-filter">
                                या निवडीत एकही चाचणी नाही — “सर्व” निवडून पाहा.
                            </p>
                        )
                    ) : (
                        <div className="space-y-4">{GROUP_ORDER.map(renderGroup)}</div>
                    )}

                    {onTell && (
                        <>
                            <BigButton onClick={onTell} tone="white" testId="test-tell"><Mic size={20} aria-hidden="true" />नमुना घेतला / निकाल आला — सांगा</BigButton>
                            {/* Telling it becomes part of that day's record; it does not move a test here. */}
                            <p className="m-0 px-1 text-[12.5px] font-semibold leading-snug text-stone-500" data-testid="test-tell-note">
                                बोलून सांगितलेलं त्या दिवसाच्या नोंदीत जातं — इथली चाचणी आपोआप बदलत नाही. ती पुढे सरकवायला कार्डवरचं बटण दाबा.
                            </p>
                        </>
                    )}

                    {canCreateProtocol && <Soon what="नवीन चाचणी-पद्धत बनवणे" />}
                </div>
            )}

            {activeAction?.kind === 'collect' && (
                <MarkCollectedSheet
                    instance={activeAction.instance}
                    onClose={closeSheet}
                    onSuccess={async (updated) => {
                        // Keep the server's answer at once, so the card moves even if the refresh below cannot reach it —
                        // but never hold the sheet shut on a hung phone database (review N1): 2 s, then move on.
                        const kept = await settleWithin(
                            getDatabase().testInstances.put(updated).then(() => true, (error: unknown) => {
                                console.error('[tests] collected on the server, but this phone could not keep the answer', { testInstanceId: updated.id, error });
                                return false;
                            }),
                            false,
                        );
                        if (!kept) console.warn('[tests] the phone copy of a collected test was not confirmed in time', { testInstanceId: updated.id });
                        await afterSave();
                    }}
                />
            )}
            {activeAction?.kind === 'record' && (
                <RecordResultSheet
                    instance={activeAction.instance}
                    protocol={protocols[activeAction.instance.testProtocolId]}
                    onClose={closeSheet}
                    onSuccess={afterSave}
                />
            )}
        </div>
    );
};

export default TestQueuePage;
