/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import {
    Calendar, ChevronRight, ChevronDown, X, Tractor, ArrowRight
} from 'lucide-react';
import { DailyLog } from '../../logs/logs.types';
import { CropProfile, Plot, LedgerDefaults } from '../../../types';
import DailyWorkSummaryView from '../../analysis/components/DailyWorkSummaryView';
import { CropSymbol } from '../../context/components/CropSelector';
import { generateDayWorkSummary } from '../../analysis/dayWorkSummary';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { AttachmentList } from '../../attachments';
import { getPhaseAndDay } from '../../../shared/utils/timelineUtils';

interface DetailHeaderInfo {
    cropName: string;
    plotName: string;
    icon: string;
    timeline: ReturnType<typeof getPhaseAndDay>;
    date: Date;
    cropColor: string;
}

interface EmptySelection {
    date: Date;
    crop: CropProfile;
    plot?: Plot;
    plotName?: string;
}

interface LogDetailDrawerProps {
    selectedLog: DailyLog | null;
    emptySelection: EmptySelection | null;
    detailInfo: DetailHeaderInfo;
    defaults: LedgerDefaults;
    selectedLogAttachmentCount: number;
    showSelectedLogAttachments: boolean;
    setShowSelectedLogAttachments: React.Dispatch<React.SetStateAction<boolean>>;
    retryUpload: (attachmentId: string) => Promise<void>;
    onClose: () => void;
    onEditLog?: (log: DailyLog) => void;
}

const LogDetailDrawer: React.FC<LogDetailDrawerProps> = ({
    selectedLog,
    emptySelection,
    detailInfo,
    defaults,
    selectedLogAttachmentCount,
    showSelectedLogAttachments,
    setShowSelectedLogAttachments,
    retryUpload,
    onClose,
    onEditLog,
}) => {
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-safe-area sm:items-center">
            {/* Dark background - click to close */}
            <div
                className="absolute inset-0 bg-black bg-opacity-60"
                onClick={onClose}
            />

            {/* Modal - SIMPLE STRUCTURE */}
            <div
                className="relative bg-white w-full max-w-lg rounded-t-3xl shadow-2xl"
                style={{
                    height: '85vh',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: '85vh'
                }}
            >
                {/* HEADER - DARK THEME WITH ACTIVITY CHIPS */}
                <div className="bg-slate-900/95 backdrop-blur-sm px-6 py-6 flex justify-between items-start shrink-0 rounded-t-3xl">
                    {/* Left: Info */}
                    <div className="flex-1">
                        {/* Icon + Date */}
                        <div className="flex items-center gap-3 mb-2">
                            <div className="bg-amber-500/20 p-2.5 rounded-xl">
                                <CropSymbol name={detailInfo.icon} size="md" />
                            </div>
                            <div className="text-slate-200 font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                                <Calendar size={16} className="text-slate-400" />
                                {detailInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
                            </div>
                        </div>

                        {/* Plot Name + Crop Name */}
                        <h2 className="text-2xl font-bold text-white leading-tight mb-1">
                            {detailInfo.plotName}
                        </h2>
                        <p className="text-base text-slate-400 font-medium mb-4">
                            · {detailInfo.cropName}
                        </p>

                        {/* TODAY: Activity Count Chips */}
                        <div className="flex flex-wrap gap-2">
                            {(() => {
                                const log = selectedLog;
                                const activityCount = log?.cropActivities?.length || 0;
                                const waterCount = log?.irrigation?.length || 0;
                                const labourCount = (log?.labour?.reduce((sum, l) => sum + (l.count || 0), 0)) || 0;
                                const inputCount = log?.inputs?.length || 0;
                                const issueCount = log?.observations?.filter(o => o.noteType === 'issue').length || 0;

                                const chipStyle = (count: number) =>
                                    count === 0
                                        ? "bg-slate-800/50 border border-red-900/30 text-red-400"
                                        : "bg-emerald-900/30 border border-emerald-700/30 text-emerald-400";

                                const countStyle = (count: number) =>
                                    count === 0 ? "text-red-400 font-bold" : "text-emerald-300 font-bold";

                                return (
                                    <>
                                        <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${chipStyle(activityCount)}`}>
                                            Activity <span className={countStyle(activityCount)}>{activityCount}</span>
                                        </div>
                                        <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${chipStyle(waterCount)}`}>
                                            Water <span className={countStyle(waterCount)}>{waterCount}</span>
                                        </div>
                                        <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${chipStyle(labourCount)}`}>
                                            Labour <span className={countStyle(labourCount)}>{labourCount}</span>
                                        </div>
                                        <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${chipStyle(inputCount)}`}>
                                            Input <span className={countStyle(inputCount)}>{inputCount}</span>
                                        </div>
                                        <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${chipStyle(issueCount)}`}>
                                            Issue <span className={countStyle(issueCount)}>{issueCount}</span>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Right: Close button */}
                    <button
                        onClick={onClose}
                        className="p-2 bg-slate-800/50 rounded-full hover:bg-slate-700/50 text-slate-300 hover:text-white transition-all ml-4"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* SCROLLABLE CONTENT AREA - SIMPLE! */}
                <div
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        WebkitOverflowScrolling: 'touch',
                        padding: '24px',
                        backgroundColor: '#FFFFFF'
                    }}
                >
                    {selectedLog ? (
                        <>
                            {selectedLogAttachmentCount > 0 && (
                                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowSelectedLogAttachments(previous => !previous)}
                                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white border border-blue-200 text-blue-700"
                                    >
                                        Attachments {selectedLogAttachmentCount}
                                    </button>
                                    {showSelectedLogAttachments && (
                                        <div className="mt-2">
                                            <AttachmentList
                                                linkedEntityId={selectedLog.id}
                                                compact
                                                onRetry={retryUpload}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                            <DailyWorkSummaryView
                                key={selectedLog.id}
                                summary={generateDayWorkSummary(selectedLog, defaults)}
                            />
                            <div className="mt-8 pt-6 border-t border-slate-200">
                                <button
                                    onClick={() => onEditLog && onEditLog(selectedLog)}
                                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-all rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg"
                                >
                                    Edit This Log <ChevronRight size={16} />
                                </button>
                            </div>
                            {/* Bottom padding for comfortable scrolling */}
                            <div style={{ height: '60px' }} />
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
                            <div className="bg-slate-200 p-4 rounded-full"><Tractor size={48} className="text-slate-400" /></div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-600">No Data Recorded</h3>
                                <p className="text-slate-400 max-w-xs mx-auto mt-2">No activity log found for {detailInfo.cropName} on this date.</p>
                            </div>
                            <button
                                onClick={() => {
                                    // Create a minimal log structure for adding new entry
                                    const newEntryTemplate: DailyLog = {
                                        id: `new_${Date.now()}`,
                                        date: getDateKey(emptySelection!.date),
                                        context: {
                                            selection: [{
                                                cropId: emptySelection!.crop.id,
                                                cropName: emptySelection!.crop.name,
                                                selectedPlotIds: emptySelection!.plot ? [emptySelection!.plot.id] : [],
                                                selectedPlotNames: emptySelection!.plot ? [emptySelection!.plot.name] : []
                                            }]
                                        },
                                        dayOutcome: 'WORK_RECORDED',
                                        cropActivities: [],
                                        irrigation: [],
                                        labour: [],
                                        inputs: [],
                                        machinery: [],
                                        activityExpenses: [],
                                        financialSummary: {
                                            totalLabourCost: 0,
                                            totalInputCost: 0,
                                            totalMachineryCost: 0,
                                            totalActivityExpenses: 0,
                                            grandTotal: 0
                                        }
                                    };
                                    onEditLog && onEditLog(newEntryTemplate);
                                }}
                                className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2 mt-4 hover:bg-emerald-700 active:scale-95 transition-all"
                            >
                                Add Missing Entry <ArrowRight size={18} />
                            </button>
                        </div>
                    )}
                </div>

                {/* SCROLL INDICATOR - Shows user they can scroll */}
                <div
                    className="absolute bottom-0 left-0 right-0 pointer-events-none"
                    style={{
                        height: '60px',
                        background: 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 100%)',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        paddingBottom: '10px'
                    }}
                >
                    <div style={{
                        fontSize: '12px',
                        color: '#9ca3af',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        animation: 'bounce 2s infinite'
                    }}>
                        <ChevronDown size={16} />
                        Scroll for more
                        <ChevronDown size={16} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LogDetailDrawer;
