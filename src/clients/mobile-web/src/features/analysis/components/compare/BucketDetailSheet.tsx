
import React from 'react';
import { ExecutionBucket } from '../../../../types';
import { X, CheckCircle2, XCircle, PlusCircle, Clock, Calendar, AlertCircle } from 'lucide-react';

interface Props {
    bucket: ExecutionBucket;
    onClose: () => void;
}

export const BucketDetailSheet: React.FC<Props> = ({ bucket, onClose }) => {
    // Build unified items list with status
    type UnifiedItem = {
        id: string;
        name: string;
        type: 'COMPLETED' | 'MISSED' | 'EXTRA' | 'UPCOMING' | 'PENDING' | 'OVERDUE';
        detail: string;
        notes?: string;
        day?: number;
    };

    const items: UnifiedItem[] = [];

    // Planned items
    bucket.planned.forEach(p => {
        if (p.isMatched) {
            const matched = bucket.executed.find(e => e.id === p.matchedExecutionId);
            items.push({
                id: p.id,
                name: p.name,
                type: 'COMPLETED',
                detail: matched ? `Done on ${matched.executedDate.split('T')[0]}` : `Day ${p.expectedDay}`,
                notes: p.notes,
                day: p.expectedDay,
            });
        } else if (p.status === 'OVERDUE') {
            items.push({
                id: p.id, name: p.name, type: 'OVERDUE',
                detail: `Due Day ${p.expectedDay} • ${p.frequency || ''}`,
                notes: p.notes, day: p.expectedDay,
            });
        } else if (p.status === 'UPCOMING') {
            items.push({
                id: p.id, name: p.name, type: 'UPCOMING',
                detail: `Day ${p.expectedDay} • ${p.frequency || ''}`,
                notes: p.notes, day: p.expectedDay,
            });
        } else if (p.status === 'PENDING') {
            items.push({
                id: p.id, name: p.name, type: 'PENDING',
                detail: `Due today • ${p.frequency || ''}`,
                notes: p.notes, day: p.expectedDay,
            });
        } else {
            // MISSED
            items.push({
                id: p.id, name: p.name, type: 'MISSED',
                detail: `Expected Day ${p.expectedDay} • ${p.frequency || ''}`,
                notes: p.notes, day: p.expectedDay,
            });
        }
    });

    // Extra executed items
    bucket.executed.filter(e => e.isExtra).forEach(e => {
        items.push({
            id: e.id,
            name: e.name,
            type: 'EXTRA',
            detail: `${e.executedDate.split('T')[0]} • ${e.quantity || '-'} ${e.unit || ''}`,
            day: e.executedDay,
        });
    });

    // Sort: OVERDUE first, then PENDING, COMPLETED, MISSED, EXTRA, UPCOMING
    const order: Record<string, number> = { OVERDUE: 0, PENDING: 1, COMPLETED: 2, MISSED: 3, EXTRA: 4, UPCOMING: 5 };
    items.sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));

    const getItemConfig = (type: string) => {
        switch (type) {
            case 'COMPLETED': return {
                bg: 'bg-emerald-50/70', border: 'border-emerald-200', leftBar: 'bg-emerald-500',
                icon: <CheckCircle2 size={14} className="text-emerald-500" />,
                badge: <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">DONE</span>
            };
            case 'MISSED': return {
                bg: 'bg-red-50/70', border: 'border-red-200', leftBar: 'bg-red-500',
                icon: <XCircle size={14} className="text-red-500" />,
                badge: <span className="text-[9px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">MISSED</span>
            };
            case 'OVERDUE': return {
                bg: 'bg-red-50/70', border: 'border-red-300', leftBar: 'bg-red-600',
                icon: <AlertCircle size={14} className="text-red-600" />,
                badge: <span className="text-[9px] font-bold text-white bg-red-500 px-2 py-0.5 rounded-full animate-pulse">OVERDUE</span>
            };
            case 'EXTRA': return {
                bg: 'bg-blue-50/70', border: 'border-blue-200', leftBar: 'bg-blue-500',
                icon: <PlusCircle size={14} className="text-blue-500" />,
                badge: <span className="text-[9px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">EXTRA</span>
            };
            case 'PENDING': return {
                bg: 'bg-amber-50/70', border: 'border-amber-200', leftBar: 'bg-amber-500',
                icon: <Clock size={14} className="text-amber-600" />,
                badge: <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">TODAY</span>
            };
            case 'UPCOMING': return {
                bg: 'bg-stone-50', border: 'border-stone-200', leftBar: 'bg-stone-300',
                icon: <Calendar size={14} className="text-stone-400" />,
                badge: <span className="text-[9px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">LATER</span>
            };
            default: return {
                bg: 'bg-white', border: 'border-stone-200', leftBar: 'bg-stone-300',
                icon: null, badge: null
            };
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-5 border-b border-stone-100 bg-white">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-lg font-black text-stone-800 tracking-tight">{bucket.bucketLabel}</h2>
                        <div className="flex items-center gap-2 mt-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100">
                                <CheckCircle2 size={10} /> {bucket.matchedCount} done
                            </span>
                            {bucket.missedCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md border border-red-100">
                                    <XCircle size={10} /> {bucket.missedCount} missed
                                </span>
                            )}
                            {bucket.extraCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                                    <PlusCircle size={10} /> {bucket.extraCount} extra
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-stone-100 rounded-full hover:bg-stone-200 transition-colors">
                        <X className="w-4 h-4 text-stone-600" />
                    </button>
                </div>

                {/* Progress bar */}
                {bucket.plannedCount > 0 && (
                    <div className="mt-3 w-full h-2 bg-stone-100 rounded-full overflow-hidden flex">
                        <div
                            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min((bucket.matchedCount / bucket.plannedCount) * 100, 100)}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Unified Items List */}
            <div className="flex-1 overflow-y-auto p-4 bg-stone-50/50 space-y-2">
                {items.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-sm font-medium">
                        No activity data for this category
                    </div>
                ) : items.map(item => {
                    const config = getItemConfig(item.type);
                    return (
                        <div
                            key={item.id}
                            className={`${config.bg} rounded-xl border ${config.border} overflow-hidden transition-all duration-150`}
                        >
                            <div className="flex">
                                {/* Left color bar */}
                                <div className={`w-1 ${config.leftBar} shrink-0`} />

                                <div className="flex-1 p-3">
                                    <div className="flex justify-between items-start">
                                        <div className="flex items-start gap-2 min-w-0">
                                            <div className="mt-0.5 shrink-0">{config.icon}</div>
                                            <div className="min-w-0">
                                                <div className="font-bold text-sm text-stone-800 truncate">{item.name}</div>
                                                <div className="text-[11px] text-stone-500 mt-0.5">{item.detail}</div>
                                            </div>
                                        </div>
                                        {config.badge}
                                    </div>
                                    {item.notes && (
                                        <div className="mt-2 text-[11px] text-stone-500 bg-white/60 px-2.5 py-1.5 rounded-lg border border-stone-100">
                                            {item.notes}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
