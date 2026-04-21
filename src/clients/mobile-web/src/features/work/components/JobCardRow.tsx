/**
 * JobCardRow — row component for a single job card.
 * CEI Phase 4 §4.8
 *
 * Layout:
 *   - Worker name + avatar (or placeholder)
 *   - Activity chips (line items)
 *   - Planned date
 *   - Estimated total
 *   - PayoutEligibilityStrip (footer)
 *   - Primary action button (varies by status)
 */

import React from 'react';
import type { JobCard } from '../../../domain/work/JobCard';
import PayoutEligibilityStrip from './PayoutEligibilityStrip';

interface JobCardRowProps {
    card: JobCard;
    onAction?: (card: JobCard, action: string) => void;
    onPress?: (card: JobCard) => void;
}

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const getInitials = (name: string): string => {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');
};

const getPrimaryAction = (card: JobCard): { label: string; labelMr: string; action: string; color: string } | null => {
    switch (card.status) {
        case 'Draft':
            return { label: 'Assign', labelMr: 'नेमणूक करा', action: 'assign', color: 'bg-stone-800 text-white' };
        case 'Assigned':
            return { label: 'Start', labelMr: 'सुरू करा', action: 'start', color: 'bg-amber-600 text-white' };
        case 'InProgress':
            return { label: 'Complete', labelMr: 'पूर्ण करा', action: 'complete', color: 'bg-blue-600 text-white' };
        case 'Completed':
            return { label: 'Verify for payout', labelMr: 'पेआउट तपासा', action: 'verify', color: 'bg-emerald-700 text-white' };
        case 'VerifiedForPayout':
            return { label: 'Settle now', labelMr: 'आता सेटल करा', action: 'settle', color: 'bg-rose-600 text-white' };
        default:
            return null;
    }
};

const JobCardRow: React.FC<JobCardRowProps> = ({ card, onAction, onPress }) => {
    const action = getPrimaryAction(card);
    const workerName = card.assignedWorkerDisplayName ?? 'Unassigned';
    const initials = card.assignedWorkerDisplayName
        ? getInitials(card.assignedWorkerDisplayName)
        : '—';

    return (
        <div
            className="rounded-2xl border border-stone-200 bg-white shadow-sm p-4 flex flex-col gap-3 active:scale-[0.99] transition-transform cursor-pointer"
            onClick={() => onPress?.(card)}
        >
            {/* Top row: avatar + name + activity chips */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${card.assignedWorkerUserId ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-400'}`}>
                        {initials}
                    </div>
                    <div>
                        <p
                            className="text-sm font-bold text-stone-900 leading-tight"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        >
                            {workerName}
                        </p>
                        <p
                            className="text-[10px] text-stone-400 font-mono"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {card.id.slice(-6).toUpperCase()}
                        </p>
                    </div>
                </div>

                {/* Activity chips */}
                <div className="flex flex-wrap gap-1 justify-end max-w-[45%]">
                    {card.lineItems.slice(0, 3).map((item, idx) => (
                        <span
                            key={idx}
                            className="text-[9px] font-bold bg-stone-100 text-stone-600 rounded-full px-2 py-0.5"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            {item.activityType}
                        </span>
                    ))}
                    {card.lineItems.length > 3 && (
                        <span
                            className="text-[9px] font-bold bg-stone-100 text-stone-400 rounded-full px-2 py-0.5"
                            style={{ fontFamily: "'DM Sans', sans-serif" }}
                        >
                            +{card.lineItems.length - 3}
                        </span>
                    )}
                </div>
            </div>

            {/* Body: date + estimated total */}
            <div className="flex items-center justify-between">
                <div>
                    <p
                        className="text-[10px] uppercase tracking-wide font-bold text-stone-400"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Planned
                    </p>
                    <p
                        className="text-sm font-semibold text-stone-700"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {formatDate(card.plannedDate)}
                    </p>
                </div>
                <div className="text-right">
                    <p
                        className="text-[10px] uppercase tracking-wide font-bold text-stone-400"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        Estimated
                    </p>
                    <p
                        className="text-sm font-bold text-stone-900"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {card.estimatedTotalCurrency} {Math.round(card.estimatedTotalAmount).toLocaleString('en-IN')}
                    </p>
                </div>
            </div>

            {/* Footer: eligibility strip + action */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <PayoutEligibilityStrip card={card} />
                {action && (
                    <button
                        onClick={e => {
                            e.stopPropagation();
                            onAction?.(card, action.action);
                        }}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold ${action.color} shrink-0`}
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                        {action.label}
                    </button>
                )}
            </div>
        </div>
    );
};

export default JobCardRow;
