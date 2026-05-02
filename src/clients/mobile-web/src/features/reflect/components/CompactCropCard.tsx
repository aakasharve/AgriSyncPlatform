/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import {
    Tractor, Ban, CheckSquare, Droplets, Users, Package, StickyNote, Bell
} from 'lucide-react';
import { DailyLog } from '../../logs/logs.types';
import { CropProfile, Plot } from '../../../types';
import { CropSymbol } from '../../context/components/CropSelector';
import { getPhaseAndDay } from '../../../shared/utils/timelineUtils';
import TrustBadge from '../../../shared/components/ui/TrustBadge';
import { MoneyChip } from '../../finance/components/MoneyChip';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { formatTemperature } from '../../../shared/utils/weatherFormatter';
import { countCompletedIrrigationEvents } from '../../logs/services/irrigationCompletion';
import { getDayStatus, getIrrigationStatus, getPrimaryLogNote } from '../helpers';

interface CompactCropCardProps {
    crop: CropProfile;
    plot?: Plot;
    plotIndex?: number;
    log?: DailyLog;
    date: Date;
    onClick: () => void;
    onCostClick?: (log: DailyLog) => void;
}

const CompactCropCard: React.FC<CompactCropCardProps> = ({ crop, plot, plotIndex: _plotIndex, log, date, onClick, onCostClick }) => {
    const status = getDayStatus(log);
    const isBlocked = log?.disturbance?.scope === 'FULL_DAY';
    const [attachmentCount, setAttachmentCount] = useState<number>(0);

    // Data Presence Checks
    const irrigationBlocked = !!(log?.disturbance?.blockedSegments?.includes('irrigation'));
    const counts = {
        activity: log?.cropActivities?.length || 0,
        irrigation: countCompletedIrrigationEvents(log?.irrigation || []),
        labour: log?.labour?.reduce((s, l) => s + (l.count || 0), 0) || 0,
        inputs: log?.inputs?.length || 0,
        machinery: log?.machinery?.length || 0,
        expenses: log?.activityExpenses?.length || 0,
        notes: log?.observations?.length || 0,
        reminders: log?.observations?.filter(o => o.noteType === 'reminder').length || 0
    };

    const borderColor = status === 'worked' ? 'border-emerald-200' : status === 'blocked' ? 'border-amber-200' : 'border-slate-100';
    const bgColor = status === 'worked' ? 'bg-white' : status === 'blocked' ? 'bg-amber-50' : 'bg-red-50/20';
    const shadow = status === 'worked' ? 'shadow-sm' : 'shadow-none';

    const targetPlot = plot || crop.plots[0];
    const timeline = getPhaseAndDay(targetPlot, date);
    const plotDisplayName = plot ? plot.name : (crop.plots.length > 1 ? 'All Plots' : crop.plots[0]?.name || 'Main Field');
    const primaryNote = getPrimaryLogNote(log);

    // NEW: Water Adherence Status
    const waterStatus = getIrrigationStatus(date, plot, log);
    const hasAttachments = attachmentCount > 0;

    useEffect(() => {
        let cancelled = false;

        const loadAttachmentCount = async () => {
            const logId = log?.id;
            if (!logId) {
                if (!cancelled) {
                    setAttachmentCount(0);
                }
                return;
            }

            try {
                const db = getDatabase();
                const count = await db.attachments
                    .where('linkedEntityId')
                    .equals(logId)
                    .count();

                if (!cancelled) {
                    setAttachmentCount(count);
                }
            } catch {
                if (!cancelled) {
                    setAttachmentCount(0);
                }
            }
        };

        void loadAttachmentCount();
        return () => {
            cancelled = true;
        };
    }, [log?.id]);

    // Helper for bucket icons
    const BucketIcon = ({ icon, count, activeColor, label: _label }: { icon: React.ReactNode, count: number, activeColor: string, label: string }) => {
        const isActive = count > 0;
        return (
            <div className={`flex flex-col items-center justify-center p-1 rounded-lg border flex-1 transition-all min-w-[30px] ${isActive ? activeColor : 'bg-slate-50 border-slate-100 text-slate-300'}`}>
                <div className="mb-0.5">{icon}</div>
                {/* <span className="text-[9px] font-bold uppercase leading-none mb-0.5">{label}</span> */}
                <span className={`text-[10px] font-bold leading-none ${isActive ? '' : 'text-slate-300'}`}>{isActive ? count : '-'}</span>
            </div>
        );
    };

    return (
        <button
            onClick={onClick}
            className={`
                relative flex flex-col items-start p-3 rounded-2xl border-2 transition-all active:scale-95 text-left
                ${borderColor} ${bgColor} ${shadow} hover:shadow-md overflow-hidden group
            `}
            style={{ minHeight: '160px' }}
        >
            <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${crop.color}`} />

            <div className="pl-2.5 w-full flex flex-col h-full">

                {/* 1. Header: Crop Name + Icon */}
                <div className="flex justify-between items-start w-full mb-0.5">
                    <div className="flex items-center gap-1.5">
                        <CropSymbol name={crop.iconName} size="sm" />
                        <span className="font-bold text-base text-slate-800 leading-tight">{crop.name}</span>
                    </div>
                    {/* Cost Pill + Trust Badge */}
                    <div className="flex items-center gap-1.5">
                        {log?.verification?.status && <TrustBadge status={log.verification.status} size="sm" />}
                        {hasAttachments && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                Attachments {attachmentCount}
                            </span>
                        )}
                        {log?.financialSummary.grandTotal ? (
                            <MoneyChip
                                amount={log.financialSummary.grandTotal}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (log && onCostClick) onCostClick(log);
                                }}
                            />
                        ) : null}
                    </div>
                </div>

                {/* 2. Sub-Header: Plot Name */}
                <div className="text-xs font-medium text-slate-500 mb-2 ml-0.5 truncate max-w-full">
                    {plotDisplayName}
                </div>
                {primaryNote && (
                    <div className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 mb-2 truncate w-full">
                        {primaryNote}
                    </div>
                )}

                {/* 2.5 Weather Display - Per Plot */}
                {log?.weatherSnapshot && (
                    <div className="flex items-center gap-1.5 text-xs bg-sky-50 px-2 py-1 rounded-lg border border-sky-100 mb-2">
                        <span className="text-base">☀️</span>
                        <span className="font-bold text-sky-800">{formatTemperature(log.weatherSnapshot.current.tempC)}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-medium text-slate-600">{log.weatherSnapshot.current.conditionText}</span>
                    </div>
                )}

                {/* 3. Highlight: Day Label + Water Status */}
                <div className="flex gap-1 flex-wrap mb-3">
                    <div className={`
                        self-start text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border
                        ${timeline.phase === 'CROP_CYCLE' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-200'}
                    `}>
                        {timeline.label}
                    </div>
                    {/* Water Status Badge */}
                    {waterStatus === 'ON_TRACK' && <div className="text-[10px] font-bold px-2 py-1 rounded-md bg-green-100 text-green-800 border border-green-200 flex items-center gap-1"><Droplets size={10} /> On Track</div>}
                    {waterStatus === 'MISSED' && <div className="text-[10px] font-bold px-2 py-1 rounded-md bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1"><Droplets size={10} /> Missed</div>}
                    {waterStatus === 'EXTRA' && <div className="text-[10px] font-bold px-2 py-1 rounded-md bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1"><Droplets size={10} /> Extra</div>}
                </div>

                {/* 4. SYMBOLIC BUCKETS ROW (8 BUCKETS) */}
                <div className="mt-auto w-full">
                    {isBlocked ? (
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-100/50 p-2 rounded-lg border border-amber-100 justify-center font-bold">
                            <Ban size={14} className="shrink-0" />
                            Work Stopped: {log.disturbance?.reason ?? 'Unknown reason'}
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-1 px-0.5">
                            <BucketIcon icon={<CheckSquare size={12} />} count={counts.activity} label="Act" activeColor="bg-emerald-50 text-emerald-600 border-emerald-100" />
                            <BucketIcon icon={<Droplets size={12} />} count={counts.irrigation} label="Wat" activeColor={irrigationBlocked ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-blue-50 text-blue-600 border-blue-100"} />
                            <BucketIcon icon={<Users size={12} />} count={counts.labour} label="Lab" activeColor="bg-orange-50 text-orange-600 border-orange-100" />
                            <BucketIcon icon={<Package size={12} />} count={counts.inputs} label="Inp" activeColor="bg-purple-50 text-purple-600 border-purple-100" />
                            <BucketIcon icon={<Tractor size={12} />} count={counts.machinery} label="Mac" activeColor="bg-indigo-50 text-indigo-600 border-indigo-100" />
                            <BucketIcon icon={<img src="/assets/rupee_black.png" alt="Expenses" className={`w-3 h-3 ${counts.expenses > 0 ? 'opacity-80' : 'opacity-30 grayscale'}`} />} count={counts.expenses} label="Exp" activeColor="bg-rose-50 text-rose-600 border-rose-100" />
                            <BucketIcon icon={<StickyNote size={12} />} count={counts.notes} label="Note" activeColor="bg-amber-50 text-amber-600 border-amber-100" />
                            <BucketIcon icon={<Bell size={12} />} count={counts.reminders} label="Rem" activeColor="bg-indigo-50 text-indigo-600 border-indigo-100" />
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
};

export default CompactCropCard;
