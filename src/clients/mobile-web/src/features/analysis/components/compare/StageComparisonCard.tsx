
import React from 'react';
import { StageComparisonUnit, ExecutionBucket } from '../../../../types';
import { ChevronRight, Droplets, FlaskConical, Sprout, Activity, AlertCircle, CheckCircle2, XCircle, PlusCircle } from 'lucide-react';

interface Props {
    stage: StageComparisonUnit;
    isCurrent: boolean;
    onBucketClick: (bucket: ExecutionBucket) => void;
    onIssuesClick?: (stage: StageComparisonUnit) => void;
}

export const StageComparisonCard: React.FC<Props> = ({ stage, isCurrent, onBucketClick, onIssuesClick }) => {
    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'COMPLETED': return 'border-emerald-200 bg-gradient-to-br from-white to-emerald-50/30';
            case 'IN_PROGRESS': return 'border-blue-200 bg-gradient-to-br from-white to-blue-50/20 shadow-md ring-1 ring-blue-100/50';
            case 'OVERDUE': return 'border-red-200 bg-gradient-to-br from-white to-red-50/20';
            case 'SKIPPED': return 'border-stone-100 bg-stone-50/50 opacity-60';
            default: return 'border-stone-100 bg-white';
        }
    };

    const getBucketIcon = (type: string) => {
        switch (type) {
            case 'SPRAY': return <FlaskConical className="w-3.5 h-3.5" />;
            case 'FERTIGATION': return <Droplets className="w-3.5 h-3.5" />;
            case 'IRRIGATION': return <Droplets className="w-3.5 h-3.5" />;
            case 'ACTIVITY': return <Activity className="w-3.5 h-3.5" />;
            default: return <Sprout className="w-3.5 h-3.5" />;
        }
    };

    const getHealthColor = (health: string) => {
        switch (health) {
            case 'ON_TRACK': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
            case 'SLIGHT_LAG': return 'text-amber-600 bg-amber-50 border-amber-100';
            case 'SIGNIFICANT_LAG': return 'text-orange-600 bg-orange-50 border-orange-100';
            case 'CRITICAL': return 'text-red-600 bg-red-50 border-red-100';
            default: return 'text-stone-500 bg-stone-50 border-stone-100';
        }
    };

    // Total delta calculations
    const totalMatched = stage.buckets.reduce((s, b) => s + b.matchedCount, 0);
    const totalMissed = stage.buckets.reduce((s, b) => s + b.missedCount, 0);
    const totalExtra = stage.buckets.reduce((s, b) => s + b.extraCount, 0);

    return (
        <div className={`rounded-2xl border overflow-hidden transition-all duration-200 ${getStatusStyles(stage.status)}`}>
            {/* Header */}
            <div className="px-4 py-3 flex justify-between items-center">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-black text-stone-800 text-sm tracking-tight">{stage.stageName}</h3>
                        {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] bg-blue-500 text-white font-bold uppercase tracking-wider shadow-sm animate-pulse">
                                Active
                            </span>
                        )}
                        {stage.status === 'COMPLETED' && (
                            <CheckCircle2 size={14} className="text-emerald-500" />
                        )}
                        {stage.issues && stage.issues.length > 0 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onIssuesClick?.(stage); }}
                                className="px-2 py-0.5 rounded-full text-[9px] bg-orange-100 text-orange-700 font-bold uppercase tracking-wider flex items-center gap-1 hover:bg-orange-200 transition-colors"
                            >
                                <AlertCircle className="w-2.5 h-2.5" /> {stage.issues.length}
                            </button>
                        )}
                    </div>
                    <div className="text-[10px] text-stone-400 font-semibold mt-0.5">
                        Day {stage.plannedStartDay} → {stage.plannedEndDay}
                    </div>
                </div>

                {/* Compact Delta Summary */}
                <div className="flex items-center gap-1.5 ml-3">
                    {totalMatched > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100">
                            <CheckCircle2 size={10} /> {totalMatched}
                        </span>
                    )}
                    {totalMissed > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded-md border border-red-100">
                            <XCircle size={10} /> {totalMissed}
                        </span>
                    )}
                    {totalExtra > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100">
                            <PlusCircle size={10} /> {totalExtra}
                        </span>
                    )}
                </div>
            </div>

            {/* Progress Bar */}
            <div className="px-4 pb-1">
                <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden flex">
                    {/* Green = matched/completed portion */}
                    {stage.completionPercent > 0 && (
                        <div
                            className="h-full bg-emerald-500 transition-all duration-700"
                            style={{ width: `${stage.completionPercent}%` }}
                        />
                    )}
                </div>
            </div>

            {/* Buckets Grid */}
            <div className="p-3 grid grid-cols-2 gap-2">
                {stage.buckets.map((bucket, idx) => {
                    const isEmpty = bucket.plannedCount === 0 && bucket.executedCount === 0;
                    return (
                        <button
                            key={idx}
                            onClick={() => onBucketClick(bucket)}
                            disabled={isEmpty}
                            className={`
                                relative flex flex-col p-3 rounded-xl border text-left transition-all duration-150 group
                                ${isEmpty
                                    ? 'opacity-30 bg-stone-50 border-dashed border-stone-200 cursor-default'
                                    : 'bg-white border-stone-100 hover:border-blue-300 hover:shadow-md active:scale-[0.97]'}
                            `}
                        >
                            <div className="flex justify-between items-center mb-2 w-full">
                                <div className={`p-1.5 rounded-lg ${getHealthColor(bucket.health)} border`}>
                                    {getBucketIcon(bucket.bucketType)}
                                </div>
                                <ChevronRight size={12} className="text-stone-300 group-hover:text-blue-400 transition-colors" />
                            </div>

                            <div className="text-xs font-bold text-stone-700 mb-2 line-clamp-1">{bucket.bucketLabel}</div>

                            {/* Delta Chips */}
                            <div className="flex flex-wrap gap-1">
                                {bucket.matchedCount > 0 && (
                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                                        ✓ {bucket.matchedCount}
                                    </span>
                                )}
                                {bucket.missedCount > 0 && (
                                    <span className="text-[9px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">
                                        ✕ {bucket.missedCount}
                                    </span>
                                )}
                                {bucket.extraCount > 0 && (
                                    <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                        + {bucket.extraCount}
                                    </span>
                                )}
                                {isEmpty && (
                                    <span className="text-[9px] font-semibold text-stone-400">No activity</span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
