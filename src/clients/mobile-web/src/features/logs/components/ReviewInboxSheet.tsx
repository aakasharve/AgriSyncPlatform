/**
 * ReviewInboxSheet Component
 *
 * The owner's READ surface for entries that are still unverified. It is the
 * destination the waiting drawer's `approval` row opens (`AppHeader`'s
 * `handleOpenDecision` -> `requestOpenReviewInbox()`).
 *
 * IT NO LONGER APPROVES ANYTHING, AND THAT IS DELIBERATE
 * ------------------------------------------------------
 * This sheet used to carry four approve/dispute affordances: a per-card
 * tick, a per-card dispute, a "Verify now" button inside the
 * cost-inaccuracy strip, and an "Approve all N entries" bar. All four
 * called `handleVerifyLog` (`app/hooks/useTrustLayer.ts`), which reaches
 * `application/usecases/VerifyLog.ts` and enqueues `verify_log_v2` — a
 * mutation whose server handler is not wired. `PushSyncBatchHandler.cs`
 * answers `MUTATION_TYPE_UNIMPLEMENTED`, `RejectionPolicy.ts` calls that
 * code PERMANENT, and the row parks in `REJECTED_USER_REVIEW`. So every tap
 * on this screen produced a rejection, forever, while the app showed the
 * owner a tick.
 *
 * The repair is NOT to point these buttons at the working v1 mutation:
 * `VerifyLogHandler.cs` runs `OnLogVerifiedAutoVerifyJobCard` on every
 * success and moves a job card `Completed -> VerifiedForPayout`, i.e. it
 * turns on a payout path for pilot farmers. That is a founder decision, not
 * an implementation detail. (`VerificationStateMachine.cs` has no
 * Draft -> Verified transition either, so a single-hop approve would fail
 * for every Draft log regardless of the mutation used.)
 *
 * So the props are GONE from the interface, not merely unused — a future
 * re-wire has to be a deliberate act that changes this file, rather than a
 * one-line callback swap at a call site. `ApprovalUnavailableNotice` says
 * so, in words, where the controls used to be (`P5`).
 *
 * WHAT SURVIVES: the list, the per-entry expansion (transcript + activity
 * summary), the counts, and the verification metrics. Seeing what happened
 * on the farm is the whole point of the oversight loop and none of it
 * depends on a server write.
 *
 * spec: owner-oversight-loop
 */

import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { DailyLog, LogVerificationStatus, FarmOperator } from '../../../types';
import { TrustBadge } from '../../../shared/components/ui/TrustBadge';
import { X, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { computeVerificationMetrics } from '../../../shared/utils/dayState';
import ApprovalUnavailableNotice from '../../../shared/components/ApprovalUnavailableNotice';

interface ReviewInboxSheetProps {
    isOpen: boolean;
    onClose: () => void;
    logs: DailyLog[];
    operators: FarmOperator[];
    currentOperatorId: string;
}

// Helper to get unverified logs needing review
const getLogsNeedingReview = (logs: DailyLog[], currentOperatorId: string): DailyLog[] => {
    return logs.filter(log => {
        // Log was created by someone else
        const createdByOther = log.meta?.createdByOperatorId !== currentOperatorId;
        // Log still needs verification
        const status = log.verification?.status;
        const isPending = !status
            || status === LogVerificationStatus.PENDING
            || status === LogVerificationStatus.DRAFT
            || status === LogVerificationStatus.CONFIRMED
            || status === LogVerificationStatus.CORRECTION_PENDING
            || status === LogVerificationStatus.DISPUTED
            || status === LogVerificationStatus.REJECTED;
        return createdByOther && isPending;
    });
};

// Group logs by date
const groupLogsByDate = (logs: DailyLog[]): Record<string, DailyLog[]> => {
    return logs.reduce((acc, log) => {
        const date = log.date;
        if (!acc[date]) acc[date] = [];
        acc[date].push(log);
        return acc;
    }, {} as Record<string, DailyLog[]>);
};

// Format date for display
const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateStr === getDateKey(today)) return 'आज (Today)';
    if (dateStr === getDateKey(yesterday)) return 'काल (Yesterday)';

    return date.toLocaleDateString('mr-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

// Calculate total cost of a log
const getLogTotalCost = (log: DailyLog): number => {
    return log.financialSummary?.grandTotal || 0;
};

// Single log review card
const LogReviewCard: React.FC<{
    log: DailyLog;
    operator?: FarmOperator;
}> = ({ log, operator }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const { t } = useLanguage();

    const activityCount = (log.cropActivities?.length || 0) +
        (log.irrigation?.length || 0) +
        (log.labour?.length || 0) +
        (log.inputs?.length || 0) +
        (log.machinery?.length || 0);

    const totalCost = getLogTotalCost(log);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {/* Operator Avatar */}
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold">
                    {operator?.name?.charAt(0) || '?'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">
                            {operator?.name || t('common.unknown')}
                        </span>
                        <TrustBadge status={LogVerificationStatus.PENDING} size="sm" />
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                        {activityCount} {t('dfes.activitiesLogged')}
                        {totalCost > 0 && ` • ₹${totalCost.toLocaleString('en-IN')}`}
                    </p>
                </div>

                {/* Expand / collapse is the ONLY affordance on this card now.
                    The approve tick and the dispute bubble that used to sit
                    here both queued `verify_log_v2`, which no server handler
                    accepts — see this file's header. */}
                <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </span>
                </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-100">
                    {/* Transcript if available */}
                    {log.fullTranscript && (
                        <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                            <p className="text-xs text-slate-500 font-medium mb-1">{t('logPage.voiceMode')}:</p>
                            <p className="text-sm text-slate-700 italic">"{log.fullTranscript}"</p>
                        </div>
                    )}

                    {/* Activity Summary */}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        {log.cropActivities?.length > 0 && (
                            <div className="p-2 bg-emerald-50 rounded-lg">
                                <span className="text-emerald-700 font-medium">
                                    {log.cropActivities.length} {t('workSummary.workBreakdown')}
                                </span>
                            </div>
                        )}
                        {log.labour?.length > 0 && (
                            <div className="p-2 bg-blue-50 rounded-lg">
                                <span className="text-blue-700 font-medium">
                                    {log.labour.length} {t('workSummary.labour')}
                                </span>
                            </div>
                        )}
                        {log.inputs?.length > 0 && (
                            <div className="p-2 bg-purple-50 rounded-lg">
                                <span className="text-purple-700 font-medium">
                                    {log.inputs.length} {t('workSummary.inputs')}
                                </span>
                            </div>
                        )}
                        {log.irrigation?.length > 0 && (
                            <div className="p-2 bg-cyan-50 rounded-lg">
                                <span className="text-cyan-700 font-medium">
                                    {log.irrigation.length} {t('workSummary.irrigation')}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const ReviewInboxSheet: React.FC<ReviewInboxSheetProps> = ({
    isOpen,
    onClose,
    logs,
    operators,
    currentOperatorId
}) => {
    const { t, language } = useLanguage();
    const logsToReview = useMemo(
        () => getLogsNeedingReview(logs, currentOperatorId),
        [logs, currentOperatorId]
    );

    const groupedLogs = useMemo(
        () => groupLogsByDate(logsToReview),
        [logsToReview]
    );
    const verificationMetrics = useMemo(
        () => computeVerificationMetrics(logs),
        [logs]
    );

    const getOperator = (operatorId?: string) =>
        operators.find(op => op.id === operatorId);

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 z-50 animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Sheet */}
            <div className="
                fixed bottom-0 left-0 right-0 z-50
                bg-white rounded-t-3xl shadow-2xl
                pb-safe-area
                max-h-[85vh] overflow-hidden
                animate-in slide-in-from-bottom duration-300
            ">
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-2">
                    <div className="w-10 h-1 bg-slate-300 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-6 pb-4 border-b border-slate-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">
                                Review Inbox
                            </h2>
                            <p className="text-sm text-slate-500 mt-0.5">
                                {logsToReview.length} {logsToReview.length === 1 ? 'entry' : 'entries'} awaiting verification
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-stone-200 bg-white p-3">
                            <p className="text-[10px] uppercase tracking-wide font-bold text-stone-400">Verification streak</p>
                            <p className="text-sm font-black text-stone-800 mt-1">{verificationMetrics.verificationStreakDays} days</p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-white p-3">
                            <p className="text-[10px] uppercase tracking-wide font-bold text-stone-400">Trusted days this month</p>
                            <p className="text-sm font-black text-stone-800 mt-1">{verificationMetrics.trustedDaysThisMonth}/{verificationMetrics.monthLength}</p>
                        </div>
                    </div>

                    {/* Still TRUE and still worth saying: these entries are
                        unverified, so any cost computed from them is provisional.
                        What is gone is the "Verify now" button that used to sit
                        inside this strip — it queued `verify_log_v2`, which the
                        server refuses. The notice below explains the absence. */}
                    {logsToReview.length > 0 && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                            Cost may be inaccurate - {logsToReview.length} entries unverified.
                        </div>
                    )}

                    {logsToReview.length > 0 && (
                        <ApprovalUnavailableNotice language={language} className="mt-3" />
                    )}
                </div>

                {/* Content */}
                <div className="overflow-y-auto max-h-[60vh] px-4 py-4">
                    {logsToReview.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Check size={32} className="text-emerald-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">{t('dfes.farmBookUpToDate')}</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                {t('logPage.noLogs')}
                            </p>
                        </div>
                    ) : (
                        Object.entries(groupedLogs).map(([date, dateLogs]) => (
                            <div key={date} className="mb-6">
                                {/* Date Header */}
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 px-1">
                                    {formatDate(date)}
                                </h3>

                                {/* Logs for this date */}
                                <div className="space-y-3">
                                    {dateLogs.map(log => (
                                        <LogReviewCard
                                            key={log.id}
                                            log={log}
                                            operator={getOperator(log.meta?.createdByOperatorId)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
};

export default ReviewInboxSheet;
