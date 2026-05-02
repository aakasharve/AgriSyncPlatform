/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DailyLog, LogVerificationStatus, FarmOperator } from '../../../types';
import { CheckCircle2, Clock, User, Calendar, DollarSign, Leaf } from 'lucide-react';

interface ReviewInboxProps {
    pendingLogs: DailyLog[];
    operators: FarmOperator[];
    onVerify: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    onViewLog: (log: DailyLog) => void;
}

const ReviewInbox: React.FC<ReviewInboxProps> = ({ pendingLogs, operators, onVerify, onViewLog }) => {
    const [isExpanded, setIsExpanded] = useState(true);

    if (pendingLogs.length === 0) return null;

    const getOperatorName = (id?: string) => {
        if (!id) return 'Unknown';
        return operators.find(op => op.id === id)?.name || 'Unknown Operator';
    };

    return (
        <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
            <div className="bg-amber-50 border border-amber-100 rounded-2xl overflow-hidden shadow-sm">
                {/* Header */}
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full flex items-center justify-between p-4 bg-amber-100/50 hover:bg-amber-100 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="bg-amber-200 text-amber-700 p-2 rounded-lg">
                            <Clock size={20} />
                        </div>
                        <div className="text-left">
                            <h3 className="font-bold text-amber-900 text-sm uppercase tracking-wide">
                                Review Inbox
                            </h3>
                            <p className="text-xs text-amber-700 font-medium">
                                {pendingLogs.length} {pendingLogs.length === 1 ? 'log' : 'logs'} pending verification
                            </p>
                        </div>
                    </div>
                    {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                </button>

                {/* List */}
                {isExpanded && (
                    <div className="divide-y divide-amber-100/50">
                        {pendingLogs.map(log => (
                            <div key={log.id} className="p-4 hover:bg-white/50 transition-colors">
                                <div className="flex justify-between items-start mb-3">
                                    {/* Creator & Date */}
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1">
                                            {log.context.selection[0].cropId === 'FARM_GLOBAL' ? (
                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                                                    <Leaf size={14} className="text-slate-500" />
                                                </div>
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-xs">
                                                    {/* Simplistic Crop Initials */}
                                                    {log.context.selection[0].cropName.substring(0, 2).toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <User size={12} className="text-amber-600" />
                                                <span className="text-xs font-bold text-slate-700">
                                                    {getOperatorName(log.meta?.createdByOperatorId)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <Calendar size={12} className="text-slate-400" />
                                                <span className="text-xs text-slate-500">
                                                    {new Date(log.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick Actions */}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onViewLog(log); }}
                                            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                                        >
                                            View
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onVerify(log.id, LogVerificationStatus.APPROVED); }}
                                            className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm flex items-center gap-1"
                                        >
                                            <CheckCircle2 size={14} />
                                            Approve
                                        </button>
                                    </div>
                                </div>

                                {/* Summary Content */}
                                <div className="pl-11">
                                    <div className="flex flex-wrap gap-2 text-xs text-slate-600 mb-2">
                                        {log.cropActivities.length > 0 && (
                                            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100">
                                                {log.cropActivities.length} Activities
                                            </span>
                                        )}
                                        {log.labour.length > 0 && (
                                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">
                                                {log.labour.reduce((s, l) => s + (l.count ?? 0), 0)} Workers
                                            </span>
                                        )}
                                        {log.financialSummary.grandTotal > 0 && (
                                            <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-100 flex items-center gap-1 font-mono">
                                                <DollarSign size={10} />
                                                {log.financialSummary.grandTotal.toLocaleString()}
                                            </span>
                                        )}
                                    </div>

                                    {/* First Activity Title as context */}
                                    {log.cropActivities.length > 0 && (
                                        <p className="text-xs text-slate-500 italic">
                                            "{log.cropActivities[0].title}"
                                            {log.cropActivities.length > 1 && ` + ${log.cropActivities.length - 1} more`}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// Simple Icons
const ChevronDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700"><path d="m6 9 6 6 6-6" /></svg>
);

const ChevronRightIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-700"><path d="m9 18 6-6-6-6" /></svg>
);

export default ReviewInbox;
