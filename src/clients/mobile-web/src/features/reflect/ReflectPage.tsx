/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useMemo } from 'react';
import { DailyLog } from '../logs/logs.types';
import { CropProfile, Plot, LedgerDefaults } from '../../types';
import {
    Calendar, ChevronRight, ArrowRight,
    BarChart3, TrendingUp, LayoutGrid, PieChart, FileText,
} from 'lucide-react';
import ObservationsPanel from '../analysis/components/ObservationsPanel';
import ToDoTasksBlock from '../scheduler/components/ToDoTasksBlock';
import CollapsibleBlock from '../../shared/components/ui/CollapsibleBlock';
// import PlotChipSelector from '../../shared/components/PlotChipSelector';
import SlidingCropSelector from '../context/components/SlidingCropSelector';
import '../analysis/components/DailyWorkSummary.css';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import ReviewInbox from '../analysis/components/ReviewInbox';
import { getHarvestSessions, getOtherIncomeEntries } from '../../services/harvestService';
import { LogVerificationStatus } from '../../types';
import CostAnalysisSection from '../analysis/components/CostAnalysisSection';
import { MoneyLensDrawer } from '../finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../finance/finance.types';
import OfflineEmptyState from '../../shared/components/ui/OfflineEmptyState';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import { useAttachmentRetry } from '../attachments';
import { useUiPref } from '../../shared/hooks/useUiPref';

import { ReflectPageProps } from './ReflectPageProps';
import { getLogForDate, getLogForSpecificPlot } from './helpers';
import DateControlBar from './components/DateControlBar';
import AccordionBlock from './components/AccordionBlock';
import CompactCropCard from './components/CompactCropCard';
import ActivityCalendarSection from './sections/ActivityCalendarSection';
import LogDetailDrawer from './sections/LogDetailDrawer';
import { useFarmContext } from '../../core/session/FarmContext';
import { emitClosureSummaryViewed } from '../../core/telemetry/eventEmitters';

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
    const { currentFarmId } = useFarmContext();
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
    // Sub-plan 04 Task 3 — block order persists through useUiPref (Dexie's
    // uiPrefs). Initial render returns the default order; the persisted
    // value swaps in once Dexie load resolves. Previously the useEffect
    // below read 'reflect-block-order' from localStorage on mount.
    const DEFAULT_BLOCK_ORDER: string[] = ['farm-status', 'notes', 'daily-logs'];
    const [blockOrder, setBlockOrder] = useUiPref<string[]>('reflect-block-order', DEFAULT_BLOCK_ORDER);

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

    // Block reordering handlers — persistence is handled inside useUiPref's
    // setter (writes to Dexie's uiPrefs).
    const moveBlock = (blockId: string, direction: 'up' | 'down') => {
        const currentIndex = blockOrder.indexOf(blockId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= blockOrder.length) return;

        const newOrder = [...blockOrder];
        [newOrder[currentIndex], newOrder[newIndex]] = [newOrder[newIndex], newOrder[currentIndex]];
        setBlockOrder(newOrder);
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

    // DWC v2 §2.8 #6 — emit closure_summary.viewed on ReflectPage mount.
    // Source = "reflect_mount" per the eventSchema enum. logsCount counts
    // the visible logs for the currently-selected date so we have a
    // first-render proxy for "summary density"; downstream session-replay
    // can correlate per-date drilldowns against drawer-open events.
    useEffect(() => {
        if (!currentFarmId) return;
        const dateKey = getDateKey(currentDate);
        const logsCount = history.filter(log => log.date === dateKey).length;
        emitClosureSummaryViewed({
            farmId: currentFarmId,
            dateKey,
            logsCount,
            source: 'reflect_mount',
        });
        // Intentionally fire only on mount + farmId resolution; date scrubbing
        // does NOT re-emit (would balloon event volume on calendar swiping).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentFarmId]);

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
            <ActivityCalendarSection
                history={history}
                crops={crops}
                viewPlots={viewPlots}
                currentDate={currentDate}
                setCurrentDate={setCurrentDate}
                calendarViewDate={calendarViewDate}
                setCalendarViewDate={setCalendarViewDate}
                calendarMode={calendarMode}
                setCalendarMode={setCalendarMode}
                isOpen={openSection === 'heatmap'}
                onToggle={() => setOpenSection(openSection === 'heatmap' ? 'status' : 'heatmap')}
            />

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
                <LogDetailDrawer
                    selectedLog={selectedLog}
                    emptySelection={emptySelection}
                    detailInfo={detailInfo}
                    defaults={defaults}
                    selectedLogAttachmentCount={selectedLogAttachmentCount}
                    showSelectedLogAttachments={showSelectedLogAttachments}
                    setShowSelectedLogAttachments={setShowSelectedLogAttachments}
                    retryUpload={retryUpload}
                    onClose={() => { setSelectedLog(null); setEmptySelection(null); }}
                    onEditLog={onEditLog}
                />
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
