
import React from 'react';
import { PlotComparisonSummary } from '../../../../types';
import { Calendar, Sprout, CheckCircle2, XCircle, PlusCircle, TrendingUp } from 'lucide-react';

interface Props {
    summary: PlotComparisonSummary;
}

export const CompareOverviewHeader: React.FC<Props> = ({ summary }) => {
    const getHealthConfig = (health: string) => {
        switch (health) {
            case 'EXCELLENT': return { gradient: 'from-emerald-600 to-teal-700', label: 'Excellent', ring: 'ring-emerald-400' };
            case 'GOOD': return { gradient: 'from-blue-600 to-indigo-700', label: 'Good', ring: 'ring-blue-400' };
            case 'NEEDS_ATTENTION': return { gradient: 'from-amber-500 to-orange-600', label: 'Attention', ring: 'ring-amber-400' };
            case 'CRITICAL': return { gradient: 'from-red-600 to-rose-700', label: 'Critical', ring: 'ring-red-400' };
            default: return { gradient: 'from-stone-600 to-stone-700', label: 'Unknown', ring: 'ring-stone-400' };
        }
    };

    const config = getHealthConfig(summary.overallHealth);
    const _completionAngle = (summary.overallCompletionPercent / 100) * 360;

    return (
        <div className="space-y-3">
            {/* Main Hero Card */}
            <div className={`rounded-3xl p-5 text-white shadow-xl bg-gradient-to-br ${config.gradient} relative overflow-hidden`}>
                {/* Background decoration */}
                <div className="absolute -top-6 -right-6 opacity-10">
                    <Sprout size={140} strokeWidth={1} />
                </div>

                <div className="relative z-10">
                    {/* Title Row */}
                    <div className="flex justify-between items-start mb-5">
                        <div>
                            <div className="flex items-center gap-2 text-white/70 text-xs font-bold uppercase tracking-widest mb-1">
                                <Calendar size={12} />
                                <span>Day {summary.currentDay}</span>
                            </div>
                            <h2 className="text-xl font-black tracking-tight leading-tight">{summary.plotName}</h2>
                            <p className="text-white/60 text-sm font-semibold">{summary.cropName}</p>
                        </div>

                        {/* Circular Score — capped 0-100% */}
                        <div className="relative flex flex-col items-center">
                            <div className="relative w-16 h-16 flex items-center justify-center">
                                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
                                    <circle
                                        cx="32" cy="32" r="28" fill="none"
                                        stroke="white" strokeWidth="5"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(Math.min(summary.overallCompletionPercent, 100) / 100) * 175.93} 175.93`}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-lg font-black leading-none">{Math.min(summary.overallCompletionPercent, 100)}%</span>
                                </div>
                            </div>
                            <span className="text-[10px] font-bold text-white/60 mt-1">
                                {summary.totalExecuted - summary.totalExtra} / {summary.totalPlanned} done
                            </span>
                        </div>
                    </div>

                    {/* Color-Coded Delta Stats */}
                    <div className="grid grid-cols-3 gap-2">
                        {/* Completed — GREEN */}
                        <div className="bg-emerald-500/25 backdrop-blur-sm rounded-xl p-3 border border-emerald-400/20">
                            <div className="flex items-center gap-1.5 mb-1">
                                <CheckCircle2 size={12} className="text-emerald-300" />
                                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-200">Done</span>
                            </div>
                            <div className="text-2xl font-black">{summary.totalExecuted}</div>
                        </div>

                        {/* Missed — RED */}
                        <div className="bg-red-500/25 backdrop-blur-sm rounded-xl p-3 border border-red-400/20">
                            <div className="flex items-center gap-1.5 mb-1">
                                <XCircle size={12} className="text-red-300" />
                                <span className="text-[9px] font-bold uppercase tracking-wider text-red-200">Missed</span>
                            </div>
                            <div className="text-2xl font-black">{summary.totalMissed}</div>
                        </div>

                        {/* Extra — BLUE */}
                        <div className="bg-blue-400/25 backdrop-blur-sm rounded-xl p-3 border border-blue-300/20">
                            <div className="flex items-center gap-1.5 mb-1">
                                <PlusCircle size={12} className="text-blue-200" />
                                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-200">Extra</span>
                            </div>
                            <div className="text-2xl font-black">{summary.totalExtra}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Health Label */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-stone-400" />
                    <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Overall Health</span>
                </div>
                <span className={`text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full ${summary.overallHealth === 'EXCELLENT' ? 'bg-emerald-100 text-emerald-700' :
                    summary.overallHealth === 'GOOD' ? 'bg-blue-100 text-blue-700' :
                        summary.overallHealth === 'NEEDS_ATTENTION' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                    }`}>
                    {config.label}
                </span>
            </div>
        </div>
    );
};
