/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowRight, CheckSquare, Droplets, Users, Package } from 'lucide-react';
import { TodayCounts } from '../../../types';

interface DailyLogCardProps {
    workDone: string;
    plotName: string;
    cropName: string;
    cropColor: string;
    loggedBy: string;
    timeLabel: string;
    statusLabel: string;
    statusTone: 'pending' | 'rejected' | 'approved';
    counts?: Partial<TodayCounts>;
    summaryLines?: string[];
    onClick: () => void;
}

const DailyLogCard: React.FC<DailyLogCardProps> = ({
    workDone,
    plotName,
    cropName,
    cropColor,
    loggedBy,
    timeLabel,
    statusLabel,
    statusTone,
    counts,
    summaryLines = [],
    onClick,
}) => {
    const compactCounts = {
        cropActivities: counts?.cropActivities || 0,
        irrigation: counts?.irrigation || 0,
        labour: counts?.labour || 0,
        inputs: counts?.inputs || 0
    };

    const statusToneClass = statusTone === 'rejected'
        ? 'bg-red-50 text-red-700 border-red-200'
        : statusTone === 'pending'
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200';

    return (
        <div className="w-full bg-white rounded-2xl shadow-sm border border-slate-100 hover:border-emerald-200 hover:shadow-md transition-all mb-3 relative overflow-hidden">
            {/* Color bar */}
            <div className={`absolute top-0 left-0 bottom-0 w-1 ${cropColor}`} />

            <button
                onClick={onClick}
                className="w-full text-left p-3"
            >
                <div className="pl-2.5 w-full">
                    <div className="flex justify-between items-start gap-2 mb-2">
                        <div>
                            <p className="text-[10px] uppercase tracking-wide font-bold text-slate-400">Work Done</p>
                            <h3 className="font-bold text-sm text-slate-900 leading-tight">{workDone}</h3>
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${statusToneClass}`}>
                            {statusLabel}
                        </span>
                    </div>

                    <p className="text-xs text-slate-600">
                        Plot: <span className="font-semibold text-slate-800">{plotName}</span>
                        <span className="mx-1 text-slate-300">|</span>
                        Crop: <span className="font-semibold text-slate-800">{cropName}</span>
                    </p>

                    <p className="text-xs text-slate-600 mt-0.5">
                        Logged by: <span className="font-semibold text-slate-800">{loggedBy}</span>
                    </p>

                    <p className="text-[11px] text-slate-500 mt-0.5">{timeLabel}</p>

                    {summaryLines.length > 0 && (
                        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5">
                            {summaryLines.map((line, index) => (
                                <p key={`${line}-${index}`} className="text-[11px] leading-relaxed text-slate-600">
                                    {line}
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <MiniBucket icon={<CheckSquare size={11} />} count={compactCounts.cropActivities} label="Act" />
                        <MiniBucket icon={<Droplets size={11} />} count={compactCounts.irrigation} label="Water" />
                        <MiniBucket icon={<Users size={11} />} count={compactCounts.labour} label="Lab" />
                        <MiniBucket icon={<Package size={11} />} count={compactCounts.inputs} label="Input" />
                    </div>

                    <div className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-300">
                        <ArrowRight size={16} />
                    </div>
                </div>
            </button>
        </div>
    );
};

const MiniBucket = ({ icon, count, label }: { icon: React.ReactNode, count: number, label: string }) => {
    const isActive = count > 0;

    return (
        <div className={`
            inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold
            ${isActive
                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                : 'bg-slate-50 border-slate-100 text-slate-400'}
        `}>
            {icon}
            <span>{label}</span>
            <span className="text-[10px] font-bold">{count > 0 ? count : 0}</span>
        </div>
    );
};

export default DailyLogCard;
