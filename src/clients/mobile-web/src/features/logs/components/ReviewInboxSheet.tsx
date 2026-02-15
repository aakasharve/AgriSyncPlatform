/**
 * ReviewInboxSheet Component
 * 
 * The "Batch Verification" flow for the DFES Trust Layer.
 * Allows owners/verifiers to approve logs created by other operators.
 * 
 * DFES Principle: "Verification can exist, but it shouldn't create friction"
 * - Batch approve at end of day
 * - One-tap approve or dispute
 * - Sampling for high-impact entries
 */

import React, { useState, useMemo } from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import { DailyLog, LogVerificationStatus, FarmOperator } from '../../../types';
import { TrustBadge } from '../../../shared/components/ui/TrustBadge';
import { Check, X, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { getDateKey } from '../../../domain/system/DateKeyService';
import { computeVerificationMetrics } from '../../../shared/utils/dayState';

interface ReviewInboxSheetProps {
    isOpen: boolean;
    onClose: () => void;
    logs: DailyLog[];
    operators: FarmOperator[];
    currentOperatorId: string;
    onApproveLog: (logId: string) => void;
    onApproveAll: (logIds: string[]) => void;
    onDisputeLog: (logId: string, note: string) => void;
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
    onApprove: () => void;
    onDispute: (note: string) => void;
}> = ({ log, operator, onApprove, onDispute }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showDisputeInput, setShowDisputeInput] = useState(false);
    const [disputeNote, setDisputeNote] = useState('');
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

                {/* Quick Actions */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => { e.stopPropagation(); onApprove(); }}
                        className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-colors"
                        title={t('dfes.confirmed')}
                    >
                        <Check size={20} strokeWidth={2.5} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowDisputeInput(true); }}
                        className="w-10 h-10 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-slate-100 transition-colors"
                        title={t('dfes.somethingNeedsFixing')}
                    >
                        <MessageSquare size={18} />
                    </button>
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

            {/* Dispute Input */}
            {showDisputeInput && (
                <div className="px-4 pb-4 border-t border-red-100 bg-red-50">
                    <p className="text-xs text-red-600 font-medium mt-3 mb-2">
                        {t('dfes.ownerHasQuestion')}
                    </p>
                    <textarea
                        value={disputeNote}
                        onChange={(e) => setDisputeNote(e.target.value)}
                        placeholder="Describe the issue..."
                        className="w-full p-2 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"
                        rows={2}
                    />
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => {
                                onDispute(disputeNote);
                                setShowDisputeInput(false);
                                setDisputeNote('');
                            }}
                            className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700"
                        >
                            {t('common.yes')}
                        </button>
                        <button
                            onClick={() => {
                                setShowDisputeInput(false);
                                setDisputeNote('');
                            }}
                            className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg text-sm"
                        >
                            {t('common.cancel')}
                        </button>
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
    currentOperatorId,
    onApproveLog,
    onApproveAll,
    onDisputeLog
}) => {
    const { t } = useLanguage();
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

    const handleApproveAll = () => {
        const allLogIds = logsToReview.map(log => log.id);
        onApproveAll(allLogIds);
    };

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

                    {logsToReview.length > 0 && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                            Cost may be inaccurate - {logsToReview.length} entries unverified.
                            {logsToReview.length > 1 && (
                                <button
                                    onClick={handleApproveAll}
                                    className="ml-2 px-2.5 py-1 rounded-md bg-amber-600 text-white text-[11px] font-bold"
                                >
                                    Verify now
                                </button>
                            )}
                        </div>
                    )}

                    {/* Approve All Button */}
                    {logsToReview.length > 1 && (
                        <button
                            onClick={handleApproveAll}
                            className="
                                w-full mt-4 py-3 rounded-xl
                                bg-gradient-to-r from-emerald-500 to-teal-500
                                text-white font-bold text-sm
                                flex items-center justify-center gap-2
                                hover:from-emerald-600 hover:to-teal-600 transition-all
                                shadow-lg shadow-emerald-200
                            "
                        >
                            <Check size={18} strokeWidth={2.5} />
                            {t('dfes.confirmed')} {t('common.all')} {logsToReview.length} {t('dfes.entries')}
                        </button>
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
                                            onApprove={() => onApproveLog(log.id)}
                                            onDispute={(note) => onDisputeLog(log.id, note)}
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
