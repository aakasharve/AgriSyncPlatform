/**
 * TestDetailPage — CEI Phase 2 §4.5 task 4.2.3.
 *
 * Shows a single test instance with:
 *   - Protocol name / stage / plot header
 *   - Parameter results table with within-range / out-of-range status
 *   - Attached lab PDFs (delegated to AttachmentList)
 *   - Recommendations list with "Add to plan" buttons
 *
 * The detail view is read-mostly; mutation happens via the queue-page sheets.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, CheckCircle, AlertTriangle, Paperclip, Plus } from 'lucide-react';
import {
    getDatabase,
    type DexieTestInstance,
    type DexieTestProtocol,
    type DexieTestRecommendation,
    type DexieTestResult,
} from '../../../infrastructure/storage/DexieDatabase';
import { getTestInstanceById, addRecommendationToPlan } from '../data/testsClient';
import AttachmentList from '../../attachments/components/AttachmentList';

interface TestDetailPageProps {
    testInstanceId: string;
    onBack: () => void;
}

const TestDetailPage: React.FC<TestDetailPageProps> = ({ testInstanceId, onBack }) => {
    const [instance, setInstance] = useState<DexieTestInstance | null>(null);
    const [protocol, setProtocol] = useState<DexieTestProtocol | null>(null);
    const [recommendations, setRecommendations] = useState<DexieTestRecommendation[]>([]);
    const [plannedRecIds, setPlannedRecIds] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const db = getDatabase();

            // 1) Dexie hydration (offline-safe)
            const cached = await db.testInstances.get(testInstanceId);
            if (cached) {
                setInstance(cached);
                const proto = await db.testProtocols.get(cached.testProtocolId);
                setProtocol(proto ?? null);
            }
            const cachedRecs = await db.testRecommendations
                .where('testInstanceId').equals(testInstanceId)
                .toArray();
            setRecommendations(cachedRecs);

            // 2) Server refresh
            try {
                const fresh = await getTestInstanceById(testInstanceId);
                setInstance(fresh);
                await db.testInstances.put(fresh);
                const proto = await db.testProtocols.get(fresh.testProtocolId);
                setProtocol(proto ?? null);
            } catch {
                // offline or transient — keep the cached render
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load test.');
        } finally {
            setIsLoading(false);
        }
    }, [testInstanceId]);

    useEffect(() => { void load(); }, [load]);

    const handleAddToPlan = async (rec: DexieTestRecommendation) => {
        if (!instance) return;
        try {
            const plannedDate = shiftDate(new Date().toISOString().slice(0, 10), rec.suggestedOffsetDays);
            await addRecommendationToPlan({
                cropCycleId: instance.cropCycleId,
                farmId: instance.farmId,
                activityName: rec.suggestedActivityName,
                stage: instance.stageName,
                plannedDate,
                reason: `From test recommendation ${rec.ruleCode}`,
            });
            setPlannedRecIds(prev => {
                const next = new Set(prev);
                next.add(rec.id);
                return next;
            });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not add to plan.');
        }
    };

    if (isLoading && !instance) {
        return (
            <div className="flex h-full items-center justify-center">
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-stone-400 text-sm">
                    Loading...
                </p>
            </div>
        );
    }

    if (!instance) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-16">
                <div className="text-4xl">🔍</div>
                <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-center text-base font-medium text-stone-600">
                    Test not found
                </p>
                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-bold text-white"
                >
                    Back
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-full bg-stone-50 pb-28">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-stone-100 px-4 py-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded-full p-1 text-stone-500 hover:bg-stone-100"
                        aria-label="Back"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-lg font-bold text-stone-800 truncate"
                        >
                            {instance.testProtocolName ?? protocol?.name ?? 'Test'}
                        </h1>
                        <p
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            className="text-xs text-stone-500 truncate"
                        >
                            {instance.stageName} · {instance.plannedDueDate}
                        </p>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                    {error}
                </div>
            )}

            {/* Results table */}
            <div className="px-4 pt-4">
                <h2
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2"
                >
                    Results
                </h2>
                {instance.results.length === 0 ? (
                    <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-500">
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }}>
                            No results recorded yet.
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
                        <table className="w-full text-sm" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                            <thead className="bg-stone-50 text-[10px] uppercase tracking-wide text-stone-500">
                                <tr>
                                    <th className="text-left px-3 py-2">Param</th>
                                    <th className="text-left px-3 py-2">Value</th>
                                    <th className="text-left px-3 py-2">Unit</th>
                                    <th className="text-left px-3 py-2">Range</th>
                                    <th className="text-left px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {instance.results.map((r, i) => (
                                    <ResultRow key={`${r.parameterCode}-${i}`} result={r} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Attached PDFs */}
            <div className="px-4 pt-5">
                <h2
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2 flex items-center gap-1"
                >
                    <Paperclip size={12} /> Lab reports
                </h2>
                <div className="rounded-2xl border border-stone-200 bg-white p-3">
                    <AttachmentList linkedEntityId={instance.id} />
                </div>
            </div>

            {/* Recommendations */}
            <div className="px-4 pt-5">
                <h2
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-xs font-bold uppercase tracking-wide text-stone-500 mb-2"
                >
                    Recommendations
                </h2>
                {recommendations.length === 0 ? (
                    <div className="rounded-2xl border border-stone-200 bg-white p-4">
                        <p style={{ fontFamily: "'DM Sans', sans-serif" }} className="text-sm text-stone-500">
                            No recommendations for this result.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {recommendations.map(rec => {
                            const isPlanned = plannedRecIds.has(rec.id);
                            return (
                                <li key={rec.id} className="rounded-2xl border border-stone-200 bg-white p-3 flex flex-col gap-2">
                                    <div>
                                        <p
                                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                            className="text-sm font-semibold text-stone-800"
                                        >
                                            {rec.titleMr}
                                        </p>
                                        <p
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                            className="text-xs text-stone-500 mt-0.5"
                                        >
                                            {rec.titleEn}
                                        </p>
                                        <p
                                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                                            className="text-[11px] text-stone-400 mt-1"
                                        >
                                            Plan in {rec.suggestedOffsetDays} {rec.suggestedOffsetDays === 1 ? 'day' : 'days'} · Rule {rec.ruleCode}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleAddToPlan(rec)}
                                        disabled={isPlanned}
                                        className={
                                            isPlanned
                                                ? 'self-start inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700'
                                                : 'self-start inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white active:bg-emerald-700'
                                        }
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    >
                                        {isPlanned ? <><CheckCircle size={12} /> Added to plan</> : <><Plus size={12} /> Add to plan</>}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

const ResultRow: React.FC<{ result: DexieTestResult }> = ({ result }) => {
    const numeric = Number(result.parameterValue);
    const hasRange = result.referenceRangeLow != null && result.referenceRangeHigh != null;
    const inRange = hasRange && !Number.isNaN(numeric)
        ? numeric >= (result.referenceRangeLow as number) && numeric <= (result.referenceRangeHigh as number)
        : undefined;

    return (
        <tr className="border-t border-stone-100">
            <td className="px-3 py-2 font-semibold text-stone-800">{result.parameterCode}</td>
            <td className="px-3 py-2 text-stone-800">{result.parameterValue}</td>
            <td className="px-3 py-2 text-stone-500">{result.unit}</td>
            <td className="px-3 py-2 text-stone-500">
                {hasRange ? `${result.referenceRangeLow}–${result.referenceRangeHigh}` : '—'}
            </td>
            <td className="px-3 py-2">
                {inRange === undefined ? (
                    <span className="text-stone-400 text-xs">—</span>
                ) : inRange ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-bold">
                        <CheckCircle size={12} /> In range
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-bold">
                        <AlertTriangle size={12} /> Out
                    </span>
                )}
            </td>
        </tr>
    );
};

const shiftDate = (iso: string, days: number): string => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
};

export default TestDetailPage;
