/**
 * DailySummaryStrip Component
 * 
 * The "Today's Anxiety Reducer" - shows at-a-glance what happened today.
 * Part of DFES Principle: "Daily felt value over dashboards"
 * 
 * Displays:
 * - Number of logs captured today
 * - Total ₹ spent today
 * - Pending tasks count
 * - Verification status summary
 */

import React from 'react';

interface DailySummaryStripProps {
    date: string; // YYYY-MM-DD
    stats: {
        logsCount: number;
        totalSpent: number;
        pendingTasks: number;
        verifiedCount: number;
        unverifiedCount: number;
    };
    isToday: boolean;
    onViewDetails?: () => void;
}

export const DailySummaryStrip: React.FC<DailySummaryStripProps> = ({
    date: _date,
    stats,
    isToday,
    onViewDetails
}) => {
    const { logsCount, totalSpent, pendingTasks, verifiedCount: _verifiedCount, unverifiedCount } = stats;

    // Format currency in Indian Rupees
    const formatCurrency = (amount: number) => {
        if (amount >= 1000) {
            return `₹${(amount / 1000).toFixed(1)}k`;
        }
        return `₹${amount}`;
    };

    return (
        <div
            className={`
                flex items-center justify-between gap-2 px-4 py-3 rounded-xl
                ${isToday
                    ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200'
                    : 'bg-slate-50 border border-slate-200'
                }
            `}
            onClick={onViewDetails}
        >
            {/* Left: Date Label */}
            <div className="flex items-center gap-2">
                {isToday && (
                    <span className="px-2 py-0.5 bg-emerald-500 text-white text-xs font-bold rounded-full">
                        आज
                    </span>
                )}
                <span className={`text-sm font-medium ${isToday ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {logsCount} {logsCount === 1 ? 'नोंद' : 'नोंदी'}
                </span>
            </div>

            {/* Center: Stats Pills */}
            <div className="flex items-center gap-2 flex-wrap justify-center">
                {/* Spend Pill */}
                {totalSpent > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-white rounded-full text-xs border border-slate-200">
                        <span className="text-amber-600">💰</span>
                        <span className="font-medium text-slate-700">{formatCurrency(totalSpent)}</span>
                    </span>
                )}

                {/* Pending Tasks Pill */}
                {pendingTasks > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 rounded-full text-xs border border-orange-200">
                        <span className="text-orange-600">📋</span>
                        <span className="font-medium text-orange-700">{pendingTasks} pending</span>
                    </span>
                )}

                {/* Verification Status */}
                {unverifiedCount > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded-full text-xs border border-slate-200">
                        <span className="text-slate-500">○</span>
                        <span className="font-medium text-slate-600">{unverifiedCount} unverified</span>
                    </span>
                )}
            </div>

            {/* Right: View Details Arrow */}
            {onViewDetails && (
                <button className="text-slate-400 hover:text-slate-600 transition-colors">
                    →
                </button>
            )}
        </div>
    );
};

export default DailySummaryStrip;
