/**
 * JobCardDetailPage — route /jobs/:id
 * CEI Phase 4 §4.8
 *
 * UI:
 *   - Header: activity summary + status pill
 *   - Timeline: Draft → Assigned → Started → Completed → VerifiedForPayout → PaidOut (or Cancelled)
 *   - Line items table: rate × hours = subtotal
 *   - Linked DailyLog preview (if set)
 *   - If PaidOut: linked CostEntry preview with amount
 *   - If Cancelled: reason + canceller
 */

import React, { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { JobCard, JobCardStatus } from '../../../domain/work/JobCard';
import PayoutEligibilityStrip from '../components/PayoutEligibilityStrip';

interface JobCardDetailPageProps {
    jobCardId: string;
    onBack: () => void;
    onNavigateToLog?: (logId: string) => void;
    onNavigateToLedger?: () => void;
    onNavigateToWorker?: (userId: string) => void;
}

const STATUS_TIMELINE: JobCardStatus[] = [
    'Draft', 'Assigned', 'InProgress', 'Completed', 'VerifiedForPayout', 'PaidOut',
];

const STATUS_LABELS: Record<string, { en: string; mr: string }> = {
    Draft: { en: 'Draft', mr: 'मसुदा' },
    Assigned: { en: 'Assigned', mr: 'नेमणूक' },
    InProgress: { en: 'Started', mr: 'सुरू' },
    Completed: { en: 'Completed', mr: 'पूर्ण' },
    VerifiedForPayout: { en: 'Verified', mr: 'तपासले' },
    PaidOut: { en: 'Paid Out', mr: 'पैसे दिले' },
    Cancelled: { en: 'Cancelled', mr: 'रद्द' },
};

const STATUS_COLORS: Partial<Record<JobCardStatus, string>> = {
    Draft: 'bg-stone-100 text-stone-600',
    Assigned: 'bg-amber-100 text-amber-700',
    InProgress: 'bg-amber-100 text-amber-700',
    Completed: 'bg-stone-100 text-stone-700',
    VerifiedForPayout: 'bg-emerald-100 text-emerald-700',
    PaidOut: 'bg-emerald-100 text-emerald-800',
    Cancelled: 'bg-rose-100 text-rose-700',
};

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const JobCardDetailPage: React.FC<JobCardDetailPageProps> = ({
    jobCardId,
    onBack,
    onNavigateToLog,
    onNavigateToLedger,
    onNavigateToWorker,
}) => {
    const [card, setCard] = useState<JobCard | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const db = getDatabase();
            const cached = await db.jobCards.get(jobCardId);
            if (!cancelled) {
                setCard(cached as unknown as JobCard ?? null);
                setIsLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [jobCardId]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-stone-50">
                <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!card) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 gap-3">
                <p
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                    className="text-sm text-stone-500"
                >
                    Job card not found
                </p>
                <button
                    onClick={onBack}
                    className="text-sm font-semibold text-emerald-700"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    Go back
                </button>
            </div>
        );
    }

    const statusColor = STATUS_COLORS[card.status] ?? 'bg-stone-100 text-stone-600';
    const statusLabel = STATUS_LABELS[card.status] ?? { en: card.status, mr: card.status };
    const _totalLineItemAmount = card.lineItems.reduce(
        (sum, item) => sum + item.expectedHours * item.ratePerHourAmount, 0
    );

    const timelineStep = (status: JobCardStatus, idx: number) => {
        const currentIdx = STATUS_TIMELINE.indexOf(card.status);
        const isActive = idx === currentIdx;
        const isDone = currentIdx !== -1 && idx < currentIdx;
        const isCancelled = card.status === 'Cancelled';

        return (
            <div key={status} className="flex items-center gap-2">
                <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                        ${isCancelled ? 'bg-stone-100 text-stone-300'
                            : isDone ? 'bg-emerald-500 text-white'
                                : isActive ? 'bg-stone-800 text-white'
                                    : 'bg-stone-100 text-stone-300'}`}
                >
                    {isDone ? '✓' : (idx + 1)}
                </div>
                <span
                    className={`text-xs font-semibold ${isCancelled ? 'text-stone-300' : isDone ? 'text-emerald-700' : isActive ? 'text-stone-800' : 'text-stone-300'}`}
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                >
                    {STATUS_LABELS[status]?.en ?? status}
                </span>
                {idx < STATUS_TIMELINE.length - 1 && (
                    <div className={`h-px flex-1 ${isDone ? 'bg-emerald-300' : 'bg-stone-100'}`} />
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col min-h-screen bg-stone-50 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-stone-100 px-4 pt-safe-area">
                <div className="flex items-center gap-3 py-3">
                    <button onClick={onBack} className="p-1 -ml-1 text-stone-500">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 5l-7 7 7 7" />
                        </svg>
                    </button>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                                className="text-base font-bold text-stone-900 leading-tight"
                            >
                                {card.lineItems.map(l => l.activityType).join(', ') || 'Job Card'}
                            </h1>
                            <span
                                className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${statusColor}`}
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {statusLabel.en}
                            </span>
                        </div>
                        <p
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                            className="text-xs text-stone-400 font-mono"
                        >
                            #{card.id.slice(-8).toUpperCase()}
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex-1 px-4 py-4 flex flex-col gap-4">
                {/* Worker */}
                {card.assignedWorkerUserId && (
                    <div className="rounded-2xl border border-stone-200 bg-white p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-sm font-black text-emerald-800 shrink-0">
                            {(card.assignedWorkerDisplayName ?? 'W').slice(0, 1).toUpperCase()}
                        </div>
                        <div className="flex-1">
                            <p
                                className="text-sm font-bold text-stone-900"
                                style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                            >
                                {card.assignedWorkerDisplayName ?? 'Worker'}
                            </p>
                            <p
                                className="text-xs text-stone-400"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Assigned worker
                            </p>
                        </div>
                        {onNavigateToWorker && (
                            <button
                                onClick={() => onNavigateToWorker(card.assignedWorkerUserId!)}
                                className="text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                View profile
                            </button>
                        )}
                    </div>
                )}

                {/* Status strip */}
                <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <PayoutEligibilityStrip card={card} />
                </div>

                {/* Timeline */}
                <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <p
                        className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-3"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Timeline
                    </p>
                    {card.status === 'Cancelled' ? (
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center text-xs font-bold text-rose-600 shrink-0">
                                ✕
                            </div>
                            <span
                                className="text-xs font-semibold text-rose-600"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Cancelled
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
                            {STATUS_TIMELINE.map((s, idx) => timelineStep(s, idx))}
                        </div>
                    )}
                </div>

                {/* Line items table */}
                <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <p
                        className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-3"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Work Items
                    </p>
                    <div className="flex flex-col gap-2">
                        {card.lineItems.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between py-2 border-b border-stone-50 last:border-0">
                                <div>
                                    <p
                                        className="text-sm font-semibold text-stone-800"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    >
                                        {item.activityType}
                                    </p>
                                    <p
                                        className="text-xs text-stone-400"
                                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                                    >
                                        {item.expectedHours}h × {item.ratePerHourCurrencyCode} {item.ratePerHourAmount}/hr
                                    </p>
                                    {item.notes && (
                                        <p
                                            className="text-xs text-stone-400 mt-0.5"
                                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                                        >
                                            {item.notes}
                                        </p>
                                    )}
                                </div>
                                <p
                                    className="text-sm font-black text-stone-900"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    {item.ratePerHourCurrencyCode} {Math.round(item.expectedHours * item.ratePerHourAmount).toLocaleString('en-IN')}
                                </p>
                            </div>
                        ))}
                        <div className="flex items-center justify-between pt-2">
                            <p
                                className="text-xs font-bold uppercase text-stone-500"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                Total
                            </p>
                            <p
                                className="text-base font-black text-stone-900"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                {card.estimatedTotalCurrency} {Math.round(card.estimatedTotalAmount).toLocaleString('en-IN')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Linked daily log */}
                {card.linkedDailyLogId && (
                    <div className="rounded-2xl border border-stone-100 bg-white p-4">
                        <p
                            className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-2"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Linked Daily Log
                        </p>
                        <div className="flex items-center justify-between">
                            <p
                                className="text-sm font-semibold text-stone-700 font-mono"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                #{card.linkedDailyLogId.slice(-8).toUpperCase()}
                            </p>
                            {onNavigateToLog && (
                                <button
                                    onClick={() => onNavigateToLog(card.linkedDailyLogId!)}
                                    className="text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg px-2 py-1"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    View log
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Payout cost entry (if settled) */}
                {card.status === 'PaidOut' && card.payoutCostEntryId && (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                        <p
                            className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 mb-2"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Payout Cost Entry
                        </p>
                        <div className="flex items-center justify-between">
                            <p
                                className="text-sm font-semibold text-emerald-800 font-mono"
                                style={{ fontFamily: "'DM Sans', sans-serif" }}
                            >
                                #{card.payoutCostEntryId.slice(-8).toUpperCase()}
                            </p>
                            {onNavigateToLedger && (
                                <button
                                    onClick={onNavigateToLedger}
                                    className="text-xs font-semibold text-emerald-700 border border-emerald-300 rounded-lg px-2 py-1"
                                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                                >
                                    View in ledger
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Cancellation details */}
                {card.status === 'Cancelled' && card.cancellationReason && (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                        <p
                            className="text-[10px] font-bold uppercase tracking-wide text-rose-500 mb-2"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            Cancellation
                        </p>
                        <p
                            className="text-sm text-rose-800"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        >
                            {card.cancellationReason}
                        </p>
                    </div>
                )}

                {/* Metadata */}
                <div className="rounded-2xl border border-stone-100 bg-white p-4">
                    <p
                        className="text-[10px] font-bold uppercase tracking-wide text-stone-400 mb-2"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Details
                    </p>
                    <div className="grid grid-cols-2 gap-y-2 text-xs">
                        <span className="text-stone-400" style={{ fontFamily: "'DM Sans', sans-serif" }}>Planned</span>
                        <span className="font-semibold text-stone-700 text-right" style={{ fontFamily: "'DM Sans', sans-serif" }}>{formatDate(card.plannedDate)}</span>
                        <span className="text-stone-400" style={{ fontFamily: "'DM Sans', sans-serif" }}>Created</span>
                        <span className="font-semibold text-stone-700 text-right" style={{ fontFamily: "'DM Sans', sans-serif" }}>{formatDate(card.createdAtUtc)}</span>
                        <span className="text-stone-400" style={{ fontFamily: "'DM Sans', sans-serif" }}>Last updated</span>
                        <span className="font-semibold text-stone-700 text-right" style={{ fontFamily: "'DM Sans', sans-serif" }}>{formatDate(card.modifiedAtUtc)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default JobCardDetailPage;
