/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DailyLog } from '../features/logs/logs.types';
import { CropProfile, Plot, LedgerDefaults } from '../types';
import {
    Calendar, ChevronRight, ChevronLeft, X, Tractor, ArrowRight,
    ChevronDown, ChevronUp, BarChart3, TrendingUp, LayoutGrid, PieChart, FileText,
    CheckSquare, Droplets, Users, Package, Ban, CloudRain, Zap, LayoutList, Grid3X3, Clock, Receipt, StickyNote, Bell
} from 'lucide-react';
import DailyWorkSummaryView from '../features/analysis/components/DailyWorkSummaryView';
import ObservationsPanel from '../features/analysis/components/ObservationsPanel';
import ToDoTasksBlock from '../features/scheduler/components/ToDoTasksBlock';
import CollapsibleBlock from '../shared/components/ui/CollapsibleBlock';
// import PlotChipSelector from '../shared/components/PlotChipSelector'; 
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import '../features/analysis/components/DailyWorkSummary.css';
import CropSelector, { CropSymbol, PlotMarker } from '../features/context/components/CropSelector';
import { getPhaseAndDay } from '../shared/utils/timelineUtils';
import { generateDayWorkSummary } from '../features/analysis/dayWorkSummary';
import { getDateKey } from '../core/domain/services/DateKeyService';
import ReviewInbox from '../features/analysis/components/ReviewInbox';
import TrustBadge from '../shared/components/ui/TrustBadge';
import { getHarvestSessions, getOtherIncomeEntries } from '../services/harvestService';
import { LogVerificationStatus, FarmOperator, OperatorCapability } from '../types';
import CostAnalysisSection from '../features/analysis/components/CostAnalysisSection';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import OfflineEmptyState from '../shared/components/ui/OfflineEmptyState';
import { getDatabase } from '../infrastructure/storage/DexieDatabase';
import { AttachmentList, useAttachmentRetry } from '../features/attachments';
import { formatTemperature } from '../shared/utils/weatherFormatter';
import { countCompletedIrrigationEvents } from '../features/logs/services/irrigationCompletion';


interface ReflectPageProps {
    history: DailyLog[];
    crops: CropProfile[];
    ledgerDefaults?: LedgerDefaults; // Optional for now, will use fallback
    onEditLog?: (log: DailyLog) => void; // Callback to navigate to Log page with pre-filled data
    onUpdateNote?: (logId: string, noteId: string, updates: any) => void;
    // Trust Layer
    onVerifyLog?: (logId: string, status: LogVerificationStatus, notes?: string) => void;
    currentOperator?: FarmOperator;
    operators?: FarmOperator[];
    navigate?: (route: any) => void;
    focusLogRequest?: { logId: string; date: string; plotId?: string } | null;
    onFocusLogConsumed?: () => void;

    // Tasks (already present)
    tasks?: any[];
    onUpdateTask?: (task: any) => void;
    onAddTask?: () => void;
}

// --- HELPERS ---

const getDisturbanceIcon = (group: string, size: number = 14) => {
    switch (group) {
        case 'WEATHER': return <CloudRain size={size} />;
        case 'ELECTRICITY': return <Zap size={size} />;
        default: return <Ban size={size} />;
    }
};

const isSameDate = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getFullYear() === d2.getFullYear();
};

const getLogForDate = (
    history: DailyLog[],
    dateStr: string,
    cropId: string,
    selectedPlotsMap: Record<string, string[]>
) => {
    const specificPlots = selectedPlotsMap[cropId] || [];

    return history.find(log => {
        const isSameDate = log.date === dateStr;
        const context = log.context.selection[0];
        const isSameCrop = context.cropId === cropId;

        if (specificPlots.length === 0) return isSameDate && isSameCrop;

        const logPlotIds = context.selectedPlotIds || [];
        const matchesPlot = logPlotIds.some(pid => specificPlots.includes(pid));

        return isSameDate && isSameCrop && matchesPlot;
    });
};

const getLogForSpecificPlot = (history: DailyLog[], dateStr: string, cropId: string, plotId: string) => {
    return history.find(log => {
        const isDate = log.date === dateStr;
        const context = log.context.selection[0];
        const isCrop = context.cropId === cropId;
        const hasPlot = context.selectedPlotIds?.includes(plotId);
        return isDate && isCrop && hasPlot;
    });
};

// NEW: Planned vs Executed Logic
type IrrigationStatus = 'ON_TRACK' | 'MISSED' | 'EXTRA' | 'SKIPPED_OK' | 'NO_PLAN';

const getIrrigationStatus = (date: Date, plot?: Plot, log?: DailyLog): IrrigationStatus => {
    if (!plot || !plot.irrigationPlan) return 'NO_PLAN';

    const { frequency, planStartDate } = plot.irrigationPlan;
    const executed = log && log.irrigation.length > 0;

    let isPlanned = false;

    // Logic: Is today a planned day?
    if (frequency === 'Daily') {
        isPlanned = true;
    } else if (frequency === 'Alternate') {
        const start = new Date(planStartDate).getTime();
        const target = date.getTime();
        const diffDays = Math.round((target - start) / (1000 * 60 * 60 * 24));
        isPlanned = diffDays % 2 === 0;
    } else if (frequency === 'Weekly') {
        // Assume execution on same weekday as start
        const startDay = new Date(planStartDate).getDay();
        isPlanned = date.getDay() === startDay;
    }

    if (isPlanned && executed) return 'ON_TRACK';
    if (isPlanned && !executed) return 'MISSED';
    if (!isPlanned && executed) return 'EXTRA';
    return 'SKIPPED_OK';
};

const getDayStatus = (log?: DailyLog) => {
    if (!log) return 'empty';
    if (log.disturbance?.scope === 'FULL_DAY') return 'blocked';
    if (log.dayOutcome === 'WORK_RECORDED') return 'worked';
    return 'empty';
};

const getPrimaryActivityName = (log: DailyLog) => {
    if (log.cropActivities.length > 0) return log.cropActivities[0].title;
    if (log.irrigation.length > 0) return "Irrigation";
    if (log.inputs.length > 0) return log.inputs[0].type === 'fertilizer' ? 'Fertilizer' : 'Spraying';
    if (log.labour.length > 0) return "Labour";
    if (log.machinery.length > 0) return log.machinery[0].type;
    return "Activity";
};

const getPrimaryLogNote = (log?: DailyLog): string | undefined => {
    if (!log) {
        return undefined;
    }

    const observation = log.observations?.[0];
    const observationText = (observation?.textCleaned || observation?.textRaw)?.trim();
    if (observationText) {
        return observationText;
    }

    const cropActivityNote = log.cropActivities.find(activity => activity.notes)?.notes?.trim();
    if (cropActivityNote) {
        return cropActivityNote;
    }

    return log.irrigation.find(event => event.notes)?.notes?.trim();
};

// --- SUB-COMPONENTS ---

interface DateControlBarProps {
    selectedDate: Date;
    onDateChange: (date: Date) => void;
    disabled?: boolean;
}

const DateControlBar: React.FC<DateControlBarProps> = ({
    selectedDate,
    onDateChange,
    disabled
}) => {
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const dayBefore = new Date(); dayBefore.setDate(today.getDate() - 2);
    const inputRef = useRef<HTMLInputElement>(null);
    const presets = [today, yesterday, dayBefore];
    const activeIndex = presets.findIndex(p => isSameDate(p, selectedDate));
    const handleCustomDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.value) onDateChange(new Date(e.target.value));
    };
    const triggerPicker = () => {
        if (inputRef.current) {
            try { (inputRef.current as any).showPicker(); } catch (e) { inputRef.current.click(); }
        }
    };

    return (
        <div className="space-y-3 mb-6">
            <div className="relative group w-full">
                <input
                    ref={inputRef}
                    type="date"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                    onChange={handleCustomDateChange}
                    max={getDateKey(today)}
                    value={getDateKey(selectedDate)}
                    disabled={disabled}
                />
                <div
                    onClick={triggerPicker}
                    className={`
                        flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer shadow-sm
                        ${disabled ? 'bg-slate-100 opacity-60' : 'bg-white hover:border-emerald-300 hover:shadow-md border-slate-200'}
                    `}
                >
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl transition-colors ${activeIndex === -1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            <Calendar size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Viewing Activity For</p>
                            <p className="text-lg font-bold text-slate-800 leading-none mt-0.5">
                                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                            </p>
                        </div>
                    </div>
                    <ChevronDown size={20} className="text-slate-400 group-hover:text-slate-600" />
                </div>
            </div>

            <div className="bg-slate-100 p-1.5 rounded-2xl flex relative shadow-inner overflow-hidden h-14">
                <div
                    className={`absolute top-1.5 bottom-1.5 w-[calc(33.33%-4px)] bg-white rounded-xl shadow-sm transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] z-0`}
                    style={{
                        left: activeIndex === 0 ? '4px' : activeIndex === 1 ? 'calc(33.33% + 2px)' : activeIndex === 2 ? 'calc(66.66%)' : '4px',
                        opacity: activeIndex === -1 ? 0 : 1,
                        transform: activeIndex === -1 ? 'scale(0.95)' : 'scale(1)'
                    }}
                />
                {presets.map((date, idx) => {
                    const isActive = activeIndex === idx;
                    const label = idx === 0 ? "Today" : idx === 1 ? "Yesterday" : date.toLocaleDateString('en-US', { weekday: 'short' });
                    return (
                        <button
                            key={idx}
                            onClick={() => onDateChange(date)}
                            disabled={disabled}
                            className={`flex-1 flex flex-col items-center justify-center relative z-10 transition-colors duration-200 ${isActive ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'
                                }`}
                        >
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-80 leading-none">{label}</span>
                            <span className="text-xs font-bold leading-tight mt-0.5">{date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

interface AccordionBlockProps {
    title: string;
    icon: React.ReactNode;
    isOpen: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

const AccordionBlock: React.FC<AccordionBlockProps> = ({ title, icon, isOpen, onToggle, children }) => {
    return (
        <div className={`bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm transition-all duration-300 ${isOpen ? 'ring-2 ring-emerald-50' : ''}`}>
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between p-5 bg-white active:bg-slate-50"
            >
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {icon}
                    </div>
                    <h3 className={`text-lg font-bold ${isOpen ? 'text-slate-800' : 'text-slate-600'}`}>{title}</h3>
                </div>
                {isOpen ? <ChevronUp className="text-slate-400" /> : <ChevronDown className="text-slate-400" />}
            </button>
            {isOpen && <div className="border-t border-slate-100 animate-in slide-in-from-top-2 p-5 bg-slate-50/30">{children}</div>}
        </div>
    );
};

interface CompactCropCardProps {
    crop: CropProfile;
    plot?: Plot;
    plotIndex?: number;
    log?: DailyLog;
    date: Date;
    onClick: () => void;
    onCostClick?: (log: DailyLog) => void;
}

const CompactCropCard: React.FC<CompactCropCardProps> = ({ crop, plot, plotIndex, log, date, onClick, onCostClick }) => {
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
    const BucketIcon = ({ icon, count, activeColor, label }: { icon: React.ReactNode, count: number, activeColor: string, label: string }) => {
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

// --- MAIN PAGE ---

const ReflectPage: React.FC<ReflectPageProps> = ({
    history,
    crops,
    ledgerDefaults,
    onEditLog,
    onUpdateNote,
    tasks,
    onUpdateTask,
    onAddTask,
    onVerifyLog,
    currentOperator,
    operators = [],
    navigate
}) => {
    // Fallback defaults if not provided
    const defaults: LedgerDefaults = ledgerDefaults || {
        irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
        labour: {
            defaultWage: 300,
            defaultHours: 8,
            shifts: [
                { id: 's1', name: 'Full Day', defaultRateMale: 400, defaultRateFemale: 250 }
            ]
        },
        machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 }
    };

    // Filter Pending Logs for Inbox
    const pendingLogs = history.filter(log => log.verification?.status === LogVerificationStatus.PENDING);
    const showInbox = onVerifyLog && pendingLogs.length > 0 && currentOperator?.isVerifier;
    const [currentDate, setCurrentDate] = useState(new Date());
    const [calendarViewDate, setCalendarViewDate] = useState(new Date());
    const [calendarMode, setCalendarMode] = useState<'week' | 'month'>('week');
    const [viewCrops, setViewCrops] = useState<string[]>([]);
    const [viewPlots, setViewPlots] = useState<Record<string, string[]>>({});
    const [openSection, setOpenSection] = useState<'status' | 'history' | 'analysis' | 'heatmap'>('status');

    // Detail Drawer
    const [selectedLog, setSelectedLog] = useState<DailyLog | null>(null);

    // Empty selection (for "Add Missing Entry" scenario)
    const [emptySelection, setEmptySelection] = useState<{
        date: Date,
        crop: CropProfile,
        plot?: Plot,
        plotName?: string
    } | null>(null);

    // Harvest Income Summary State
    const [seasonalIncome, setSeasonalIncome] = useState<number>(0);
    const [moneyLensOpen, setMoneyLensOpen] = useState(false);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters>({});
    const [selectedLogAttachmentCount, setSelectedLogAttachmentCount] = useState(0);
    const [showSelectedLogAttachments, setShowSelectedLogAttachments] = useState(false);
    const { retryUpload } = useAttachmentRetry();

    // Update income summary when context changes
    useEffect(() => {
        // Calculate total in-hand income for current crop/plot filtering
        let total = 0;

        // If specific crops are selected, sum their sessions
        if (viewCrops.length > 0) {
            viewCrops.forEach(cid => {
                const plots = viewPlots[cid] || [];
                if (plots.length > 0) {
                    plots.forEach(pid => {
                        const sess = getHarvestSessions(pid, cid);
                        total += sess.reduce((sum, s) => sum + s.totalIncome, 0);
                    });
                }
            });
        }

        // Add Other Income (Total for now for simplicity)
        const other = getOtherIncomeEntries();
        total += other.reduce((sum, o) => sum + o.amount, 0);

        setSeasonalIncome(total);
    }, [viewCrops, viewPlots, history]);

    // Block Ordering State
    const [blockOrder, setBlockOrder] = useState<string[]>(['farm-status', 'notes', 'daily-logs']);

    useEffect(() => {
        let cancelled = false;
        const selectedLogId = selectedLog?.id;
        setShowSelectedLogAttachments(false);

        const loadSelectedLogAttachmentCount = async () => {
            if (!selectedLogId) {
                if (!cancelled) {
                    setSelectedLogAttachmentCount(0);
                }
                return;
            }

            try {
                const db = getDatabase();
                const count = await db.attachments
                    .where('linkedEntityId')
                    .equals(selectedLogId)
                    .count();

                if (!cancelled) {
                    setSelectedLogAttachmentCount(count);
                }
            } catch {
                if (!cancelled) {
                    setSelectedLogAttachmentCount(0);
                }
            }
        };

        void loadSelectedLogAttachmentCount();
        return () => {
            cancelled = true;
        };
    }, [selectedLog?.id]);

    const openLogMoneyLens = (log: DailyLog) => {
        const selection = log.context.selection?.[0];
        setMoneyLensFilters({
            fromDate: log.date,
            toDate: log.date,
            cropId: selection?.cropId === 'FARM_GLOBAL' ? undefined : selection?.cropId,
            plotId: selection?.selectedPlotIds?.[0]
        });
        setMoneyLensOpen(true);
    };

    // Load block order from localStorage
    // Initialize selection to ALL plots on mount (if empty)
    useEffect(() => {
        if (viewCrops.length === 0 && crops.length > 0) {
            const allPlots: Record<string, string[]> = {};
            const allCrops: string[] = [];

            crops.forEach(crop => {
                if (crop.plots && crop.plots.length > 0) {
                    allPlots[crop.id] = crop.plots.map(p => p.id);
                    allCrops.push(crop.id);
                } else {
                    allCrops.push(crop.id); // Even crops without plots
                }
            });

            setViewCrops(allCrops);
            setViewPlots(allPlots);
        }
    }, [crops]);
    useEffect(() => {
        const savedOrder = localStorage.getItem('reflect-block-order');
        if (savedOrder) {
            try {
                setBlockOrder(JSON.parse(savedOrder));
            } catch (e) {
                console.error('Failed to parse saved block order', e);
            }
        }
    }, []);

    // Save block order to localStorage
    const saveBlockOrder = (newOrder: string[]) => {
        setBlockOrder(newOrder);
        localStorage.setItem('reflect-block-order', JSON.stringify(newOrder));
    };

    // Block reordering handlers
    const moveBlock = (blockId: string, direction: 'up' | 'down') => {
        const currentIndex = blockOrder.indexOf(blockId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= blockOrder.length) return;

        const newOrder = [...blockOrder];
        [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
        saveBlockOrder(newOrder);
    };
    const currentDateStr = getDateKey(currentDate);

    const isLogVisibleInCurrentSelection = (log: DailyLog): boolean => {
        const context = log.context.selection[0];
        const cropId = context.cropId;

        if (!viewCrops.includes(cropId)) {
            return false;
        }

        const selectedPlots = viewPlots[cropId] || [];
        if (selectedPlots.length === 0) {
            return true;
        }

        return context.selectedPlotIds?.some(plotId => selectedPlots.includes(plotId)) ?? false;
    };

    const observationsForDate = useMemo(
        () => history
            .filter(log => log.date === currentDateStr && isLogVisibleInCurrentSelection(log))
            .flatMap(log => log.observations ?? []),
        [history, currentDateStr, viewCrops, viewPlots]
    );

    const tasksFromTodaysLogs = useMemo(
        () => history
            .filter(log => log.date === currentDateStr && isLogVisibleInCurrentSelection(log))
            .flatMap(log => log.plannedTasks ?? []),
        [history, currentDateStr, viewCrops, viewPlots]
    );

    const mergedVisibleTasks = useMemo(() => {
        const deduped = new Map<string, any>();
        [...(tasks || []), ...tasksFromTodaysLogs].forEach(task => {
            deduped.set(task.id, task);
        });
        return Array.from(deduped.values());
    }, [tasks, tasksFromTodaysLogs]);

    useEffect(() => {
        if (viewCrops.length === 0 && crops.length > 0) {
            setViewCrops(crops.map(c => c.id));
        }
    }, [crops]);

    const filteredCrops = crops.filter(c => viewCrops.includes(c.id));

    const handleCardClick = (crop: CropProfile, plot?: Plot) => {
        let log;
        if (plot) {
            log = getLogForSpecificPlot(history, currentDateStr, crop.id, plot.id);
        } else {
            log = getLogForDate(history, currentDateStr, crop.id, viewPlots);
        }

        if (log) {
            setSelectedLog(log);
            setEmptySelection(null);
        } else {
            setSelectedLog(null);
            setEmptySelection({ crop, date: new Date(currentDateStr), plotName: plot?.name, plot: plot });
        }
    };

    // --- CALENDAR LOGIC ---

    const generateCalendarDays = () => {
        const days: (Date | null)[] = [];
        const baseDate = new Date(calendarViewDate);

        if (calendarMode === 'month') {
            const year = baseDate.getFullYear();
            const month = baseDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const startPadding = firstDay.getDay();

            for (let i = 0; i < startPadding; i++) days.push(null);
            for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
        } else {
            const day = baseDate.getDay();
            const startOfWeek = new Date(baseDate);
            startOfWeek.setDate(baseDate.getDate() - day);

            for (let i = 0; i < 7; i++) {
                const d = new Date(startOfWeek);
                d.setDate(startOfWeek.getDate() + i);
                days.push(d);
            }
        }
        return days;
    };

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newDate = new Date(calendarViewDate);
        if (calendarMode === 'month') {
            newDate.setMonth(newDate.getMonth() - 1);
        } else {
            newDate.setDate(newDate.getDate() - 7);
        }
        setCalendarViewDate(newDate);
    };

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation();
        const newDate = new Date(calendarViewDate);
        if (calendarMode === 'month') {
            newDate.setMonth(newDate.getMonth() + 1);
        } else {
            newDate.setDate(newDate.getDate() + 7);
        }
        setCalendarViewDate(newDate);
    };

    const getDayMetrics = (dayDate: Date) => {
        const dateStr = getDateKey(dayDate);
        const logs = history.filter(l => l.date === dateStr);
        const cropIds = new Set<string>();
        let isBlocked = false;
        let disturbanceGroup = '';

        const isRainyDay = logs.some(l =>
            l.weatherSnapshot?.current.iconCode === 'rain' ||
            l.weatherSnapshot?.current.iconCode === 'storm'
        );

        const filteredLogs = logs.filter(l => {
            const context = l.context.selection[0];
            const cId = context.cropId;
            const specificPlots = viewPlots[cId] || [];

            if (specificPlots.length > 0) {
                const logPlots = context.selectedPlotIds || [];
                const hasMatch = logPlots.some(pid => specificPlots.includes(pid));
                if (!hasMatch) return false;
            }

            if (l.disturbance?.scope === 'FULL_DAY') {
                isBlocked = true;
                disturbanceGroup = l.disturbance.group;
            }
            if (cId === 'FARM_GLOBAL') {
            } else {
                cropIds.add(cId);
            }
            return true;
        });

        return {
            cropIds: Array.from(cropIds),
            isBlocked,
            disturbanceGroup,
            hasGlobal: filteredLogs.some(l => l.context.selection.some(s => s.cropId === 'FARM_GLOBAL')),
            logs: filteredLogs,
            isRainyDay
        };
    };

    const calendarDays = generateCalendarDays();

    const getCalendarTitle = () => {
        if (calendarMode === 'month') {
            return calendarViewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        } else {
            const days = calendarDays.filter(d => d !== null) as Date[];
            if (days.length === 0) return '';
            const start = days[0];
            const end = days[6];
            const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `${startStr} - ${endStr}`;
        }
    };

    const getDetailHeaderInfo = () => {
        if (selectedLog) {
            const context = selectedLog.context.selection[0];
            const crop = crops.find(c => c.id === context.cropId);
            const plot = crop?.plots.find(p => p.id === context.selectedPlotIds[0]) || crop?.plots[0];
            const timeline = getPhaseAndDay(plot, selectedLog.date);
            const plotName = context.selectedPlotNames.length > 0 ? context.selectedPlotNames.join(', ') : 'All Plots';

            return {
                cropName: context.cropName,
                plotName: plotName,
                icon: crop?.iconName || 'Sprout',
                timeline: timeline,
                date: new Date(selectedLog.date),
                cropColor: crop?.color || 'bg-slate-500'
            };
        }
        if (emptySelection) {
            const crop = emptySelection.crop;
            const plot = emptySelection.plot || crop.plots[0];
            const timeline = getPhaseAndDay(plot, emptySelection.date);

            return {
                cropName: crop.name,
                plotName: emptySelection.plotName || 'Main Field',
                icon: crop.iconName,
                timeline: timeline,
                date: new Date(emptySelection.date),
                cropColor: crop.color
            };
        }
        return null;
    };

    const detailInfo = getDetailHeaderInfo();

    // Define block content
    const renderFarmStatusBlock = () => (
        <div className="space-y-4">
            <SlidingCropSelector
                crops={crops}
                selectedCropId={viewCrops[0] || null}
                onSelect={(id) => {
                    setViewCrops([id]);
                    // Clear plots when switching crop to default "All Plots" for that crop?
                    // Or keep previous behavior?
                    // ReflectPage logic defaults to "All Plots" if empty.
                    // We'll reset plots for the new crop.
                    const crop = crops.find(c => c.id === id);
                    if (crop) {
                        setViewPlots({ [id]: crop.plots.map(p => p.id) });
                    }
                }}
                selectedPlotIds={viewPlots[viewCrops[0]] || []}
                onPlotSelect={(plotId) => {
                    const currentCropId = viewCrops[0];
                    const currentPlots = viewPlots[currentCropId] || [];
                    let newPlots;
                    if (currentPlots.includes(plotId)) {
                        newPlots = currentPlots.filter(p => p !== plotId);
                    } else {
                        newPlots = [...currentPlots, plotId];
                    }
                    setViewPlots({ ...viewPlots, [currentCropId]: newPlots });
                }}
            />
        </div>
    );

    const renderNotesBlock = () => (
        <div className="space-y-4">
            <ObservationsPanel
                observations={observationsForDate}
                dateStr={currentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            />
            <ToDoTasksBlock
                tasks={mergedVisibleTasks}
                crops={crops}
                selectedCropId={viewCrops.length === 1 ? viewCrops[0] : undefined}
                onUpdateTask={onUpdateTask || (() => { })}
                onAddTask={onAddTask}
            />
        </div>
    );

    const renderDailyLogsBlock = () => (
        <div className="space-y-4">
            {/* Dashboard Hero Section (Replaced old header spacing) */}
            <div className="pt-2 px-1 mb-6">
                <div
                    onClick={() => navigate && navigate({ route: 'income', view: 'main' })}
                    className="glass-panel p-5 rounded-[2rem] border-emerald-100/50 shadow-xl shadow-emerald-500/5 bg-gradient-to-br from-white to-emerald-50/30 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-all overflow-hidden relative group"
                >
                    {/* Background Decor */}
                    <div className="absolute -right-4 -top-4 opacity-[0.03] text-emerald-600 rotate-12 group-hover:rotate-0 transition-transform duration-700">
                        <BarChart3 size={100} />
                    </div>

                    <div className="flex items-center gap-4 relative z-10">
                        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 group-hover:rotate-6 transition-transform">
                            <TrendingUp size={28} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-0.5">In Hand Income</p>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-slate-800 tracking-tight">₹{seasonalIncome.toLocaleString()}</span>
                                <span className="text-xs font-bold text-slate-400">Seasonal</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-2 bg-emerald-100/50 rounded-full text-emerald-600 relative z-10">
                        <ChevronRight size={20} />
                    </div>
                </div>
            </div>

            <DateControlBar selectedDate={currentDate} onDateChange={(d) => { setCurrentDate(d); setCalendarViewDate(d); }} />

            <div className="grid grid-cols-2 gap-3">
                {filteredCrops.length > 0 ? filteredCrops.flatMap(crop => {
                    const selectedPlotsForCrop = viewPlots[crop.id] || [];
                    const hasPlots = crop.plots && crop.plots.length > 0;

                    if (hasPlots) {
                        const plotsToShow = selectedPlotsForCrop.length > 0
                            ? crop.plots.filter(p => selectedPlotsForCrop.includes(p.id))
                            : crop.plots;

                        return plotsToShow.map((plot, idx) => {
                            const originalIndex = crop.plots.findIndex(p => p.id === plot.id);
                            return (
                                <CompactCropCard
                                    key={`${crop.id}-${plot.id}`}
                                    crop={crop}
                                    plot={plot}
                                    plotIndex={originalIndex}
                                    date={currentDate}
                                    log={getLogForSpecificPlot(history, currentDateStr, crop.id, plot.id)}
                                    onClick={() => handleCardClick(crop, plot)}
                                    onCostClick={openLogMoneyLens}
                                />
                            );
                        });
                    } else {
                        // No plots case
                        const log = getLogForDate(history, currentDateStr, crop.id, viewPlots);
                        return (
                            <CompactCropCard
                                key={crop.id}
                                crop={crop}
                                plot={crop.plots?.[0] || { id: 'default', name: 'Main Field' } as Plot}
                                plotIndex={0}
                                date={currentDate}
                                log={log}
                                onClick={() => handleCardClick(crop, crop.plots?.[0])}
                                onCostClick={openLogMoneyLens}
                            />
                        );
                    }
                }) : (
                    <div className="col-span-2">
                        <OfflineEmptyState
                            icon={<Calendar size={40} className="text-slate-300" />}
                            title="No Activity Today"
                            message="Select crops and plots above, or add your first daily entry."
                        />
                    </div>
                )}
            </div>
        </div>
    );

    // Block metadata
    const blocks = {
        'farm-status': {
            id: 'farm-status',
            title: 'Farm Status',
            icon: <LayoutGrid size={24} />,
            render: renderFarmStatusBlock
        },
        'notes': {
            title: `Observations & Notes (${observationsForDate.length})`,
            icon: <FileText size={24} />,
            render: renderNotesBlock
        },
        'daily-logs': {
            title: `Today's Plot wise activity - ${currentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
            icon: <Calendar size={24} />,
            render: renderDailyLogsBlock
        }
    };

    return (
        <div className="pb-20 space-y-4 animate-in fade-in duration-500">

            {/* REVIEW INBOX (Trust Layer 2) */}
            {showInbox && operators && (
                <div className="px-4 pt-4">
                    <ReviewInbox
                        pendingLogs={pendingLogs}
                        operators={operators}
                        onVerify={onVerifyLog!}
                        onViewLog={(log) => {
                            setCurrentDate(new Date(log.date));
                        }}
                    />
                </div>
            )}

            {/* Farm Status - Fixed at Top (Non-Reorderable) */}
            <CollapsibleBlock
                id="farm-status"
                title="Farm Status"
                icon={<LayoutGrid size={24} />}
                defaultOpen={true}
                showReorder={false}
                collapsible={false}
            >
                <div className="space-y-4">
                    {renderFarmStatusBlock()}
                </div>
            </CollapsibleBlock>

            {/* Other Blocks - Reorderable */}
            {blockOrder.filter(id => id !== 'farm-status').map((blockId, index, arr) => {
                const block = blocks[blockId as keyof typeof blocks];
                if (!block) return null;

                return (
                    <CollapsibleBlock
                        key={blockId}
                        id={blockId}
                        title={block.title}
                        icon={block.icon}
                        defaultOpen={blockId === 'notes' ? observationsForDate.length > 0 : true}
                        showReorder={true}
                        canMoveUp={index > 0}
                        canMoveDown={index < arr.length - 1}
                        onMoveUp={() => moveBlock(blockId, 'up')}
                        onMoveDown={() => moveBlock(blockId, 'down')}
                    >
                        {blockId === 'notes' ? (
                            block.render()
                        ) : (
                            <div className="space-y-4">
                                {block.render()}
                            </div>
                        )}
                    </CollapsibleBlock>
                );
            })}

            {/* --- BLOCK 2: CALENDAR --- */}
            <AccordionBlock
                title="Activity Calendar"
                icon={<Calendar size={20} />}
                isOpen={openSection === 'heatmap'}
                onToggle={() => setOpenSection(openSection === 'heatmap' ? 'status' : 'heatmap')}
            >
                <div className="space-y-4 px-1">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                            <button onClick={() => setCalendarMode('week')} className={`p-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all ${calendarMode === 'week' ? 'bg-white shadow text-emerald-700' : 'text-slate-500'}`}><LayoutList size={14} /> Week</button>
                            <button onClick={() => setCalendarMode('month')} className={`p-2 rounded-lg flex items-center gap-2 text-xs font-bold transition-all ${calendarMode === 'month' ? 'bg-white shadow text-emerald-700' : 'text-slate-500'}`}><Grid3X3 size={14} /> Month</button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={handlePrev} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"><ChevronLeft size={20} /></button>
                            <span className="font-bold text-sm text-slate-800 w-32 text-center">{getCalendarTitle()}</span>
                            <button onClick={handleNext} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"><ChevronRight size={20} /></button>
                        </div>
                    </div>

                    {calendarMode === 'week' && (
                        <div className="space-y-2">
                            {calendarDays.map((date, i) => {
                                if (!date) return null;
                                const { isBlocked, disturbanceGroup, hasGlobal, logs, isRainyDay } = getDayMetrics(date);
                                const isSelected = isSameDate(date, currentDate);

                                return (
                                    <button
                                        key={date.toISOString()}
                                        onClick={() => setCurrentDate(date)}
                                        className={`
                                    w-full flex items-stretch border rounded-xl overflow-hidden transition-all duration-200 relative
                                    ${isSelected ? 'bg-white border-emerald-500 ring-1 ring-emerald-500 shadow-md transform scale-[1.01]' : 'bg-white border-slate-200 hover:border-emerald-200'}
                                    ${isBlocked ? 'bg-amber-50/50 border-amber-200' : ''}
                                `}
                                    >
                                        {isRainyDay && !isBlocked && <div className="absolute inset-0 bg-blue-50/30 pointer-events-none" />}
                                        <div className={`w-16 flex flex-col items-center justify-center p-2 border-r shrink-0 ${isSelected ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                                            <span className="text-[10px] font-bold uppercase">{date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                                            <span className="text-2xl font-bold leading-none">{date.getDate()}</span>
                                        </div>
                                        <div className="flex-1 p-2 flex flex-col gap-1.5 justify-center">
                                            {isBlocked ? (
                                                <div className="flex items-center gap-2 bg-amber-100 px-3 py-1.5 rounded-lg text-amber-800 w-full relative z-10">
                                                    <div className="shrink-0">{getDisturbanceIcon(disturbanceGroup, 18)}</div>
                                                    <div className="flex flex-col items-start"><span className="text-xs font-bold uppercase tracking-wider">Work Stopped</span><span className="text-xs opacity-80">{disturbanceGroup} Issue</span></div>
                                                </div>
                                            ) : (
                                                <>
                                                    {hasGlobal && <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-slate-700 border border-slate-200 relative z-10"><CropSymbol name="Warehouse" size="sm" /><span className="text-xs font-bold">Farm Maintenance</span></div>}
                                                    {logs.length > 0 && !hasGlobal && !isBlocked ? (
                                                        <div className="flex flex-wrap gap-2 relative z-10">
                                                            {logs.map((log) => {
                                                                const crop = crops.find(c => c.id === log.context.selection[0].cropId);
                                                                if (!crop) return null;
                                                                const plotName = log.context.selection[0].selectedPlotNames[0];
                                                                const plotIndex = crop.plots.findIndex(p => p.name === plotName);
                                                                const hasSpecificPlot = plotIndex >= 0;
                                                                return (
                                                                    <div key={log.id} className={`flex items-center gap-2 px-2 py-1 rounded-lg text-white ${crop.color} shadow-sm border border-white/20 grow-0`}>
                                                                        <CropSymbol name={crop.iconName} size="xs" />
                                                                        <div className="flex flex-col items-start leading-none"><span className="text-[10px] opacity-90 font-medium truncate max-w-[100px] flex items-center gap-1">{hasSpecificPlot ? (<><PlotMarker index={plotIndex} colorClass="bg-white" />{plotName}</>) : crop.name}</span><span className="text-xs font-bold">{getPrimaryActivityName(log)}</span></div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : !hasGlobal && <span className="text-xs text-slate-400 italic pl-1 text-left relative z-10">No activity logged</span>}
                                                </>
                                            )}
                                            {isRainyDay && <div className="absolute top-1 right-1 opacity-50 text-blue-400"><CloudRain size={12} /></div>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {calendarMode === 'month' && (
                        <>
                            <div className="grid grid-cols-7 mb-2">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d} className="text-center text-xs font-bold text-slate-400 uppercase">{d}</div>)}</div>
                            <div className="grid grid-cols-7 gap-1">
                                {calendarDays.map((date, i) => {
                                    if (!date) return <div key={`empty-${i}`} className="min-h-[70px]" />;
                                    const { cropIds, isBlocked, hasGlobal, isRainyDay } = getDayMetrics(date);
                                    const isSelected = isSameDate(date, currentDate);
                                    const isToday = isSameDate(date, new Date());
                                    const showBlocked = isBlocked;
                                    const showGlobal = !isBlocked && hasGlobal;
                                    const cropsToShow = isBlocked ? [] : cropIds;
                                    return (
                                        <button key={date.toISOString()} onClick={() => setCurrentDate(date)} className={`min-h-[70px] rounded-lg border flex flex-col justify-between p-1 relative transition-all duration-200 overflow-hidden text-left ${isSelected ? 'bg-white border-emerald-500 ring-2 ring-emerald-500 z-10 shadow-md transform scale-105' : 'bg-white border-slate-100 hover:border-emerald-300 hover:shadow-sm'} ${isBlocked ? 'bg-amber-50 border-amber-200' : ''} ${isRainyDay && !isBlocked && !isSelected ? 'bg-blue-50/40 border-blue-100' : ''}`}>
                                            <span className={`text-[10px] font-bold ml-0.5 ${isSelected ? 'text-emerald-700' : isToday ? 'text-slate-900' : 'text-slate-300'}`}>{date.getDate()}</span>
                                            {isRainyDay && !isBlocked && <div className="absolute top-1 right-1 text-blue-300"><CloudRain size={10} /></div>}
                                            <div className="w-full flex flex-col gap-0.5 px-0.5 pb-1">
                                                {showBlocked && <div className="h-1.5 w-full bg-amber-400 rounded-full" />}
                                                {showGlobal && <div className="h-1.5 w-full bg-slate-400 rounded-full" />}
                                                {cropsToShow.slice(0, 4).map(cid => { const crop = crops.find(c => c.id === cid); if (!crop) return null; return (<div key={cid} className={`h-1.5 w-full rounded-full ${crop.color}`} />); })}
                                                {cropsToShow.length > 4 && <div className="h-1.5 w-full bg-slate-200 rounded-full" />}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </>
                    )}

                    <div className="flex items-center justify-center gap-4 mt-4 pt-2 border-t border-slate-200/50">
                        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-slate-400" /><span className="text-[10px] font-bold text-slate-400 uppercase">Work</span></div>
                        <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full bg-amber-400" /><span className="text-[10px] font-bold text-slate-400 uppercase">Stopped</span></div>
                        <div className="flex items-center gap-1.5"><CloudRain size={10} className="text-blue-400" /><span className="text-[10px] font-bold text-slate-400 uppercase">Rainy</span></div>
                    </div>
                </div>
            </AccordionBlock>

            {/* --- BLOCK 3: ANALYSIS --- */}
            <AccordionBlock title="Yield & Cost Analysis" icon={<PieChart size={20} />} isOpen={openSection === 'analysis'} onToggle={() => setOpenSection(openSection === 'analysis' ? 'status' : 'analysis')}>
                <CostAnalysisSection
                    logs={history}
                    crops={crops}
                    selectedCropIds={viewCrops}
                    selectedPlotsByCrop={viewPlots}
                    selectedDate={calendarViewDate}
                    calendarMode={calendarMode}
                />
                
                {navigate && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                        <button
                            onClick={() => navigate('finance-ledger')}
                            className="w-full py-3 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 active:scale-95 transition-all rounded-xl text-blue-700 font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
                        >
                            Open Finance Ledger <ArrowRight size={16} />
                        </button>
                    </div>
                )}
            </AccordionBlock>

            {/* Detail Drawer - REDESIGNED FOR SIMPLE SCROLLING */}
            {(selectedLog || emptySelection) && detailInfo && (
                <div className="fixed inset-0 z-50 flex items-end justify-center pb-safe-area sm:items-center">
                    {/* Dark background - click to close */}
                    <div
                        className="absolute inset-0 bg-black bg-opacity-60"
                        onClick={() => { setSelectedLog(null); setEmptySelection(null); }}
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
                                onClick={() => { setSelectedLog(null); setEmptySelection(null); }}
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
            )}

            <MoneyLensDrawer
                isOpen={moneyLensOpen}
                onClose={() => setMoneyLensOpen(false)}
                filters={moneyLensFilters}
            />
        </div>
    );
};

export default ReflectPage;
