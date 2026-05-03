import React, { useEffect, useMemo, useState } from 'react';
import { Plot, CropProfile, DailyLog } from '../types';

import { generatePlotComparison } from '../features/compare/plotComparisonService';
import { getTemplateById as getScheduleById } from '../infrastructure/reference/TemplateCatalog';
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import DayCard from '../features/scheduler/components/DayCard';
import {
    ArrowLeft,
    ShieldAlert,
    BookOpen,
    CheckCircle2,
    XCircle,
    PlusCircle,
    Droplets,
    GitCompare,
    ChevronDown,
    ChevronUp,
    CalendarDays
} from 'lucide-react';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { financeSelectors } from '../features/finance/financeSelectors';
import { FinanceFilters } from '../features/finance/finance.types';
import {
    CATEGORY_ORDER,
    CATEGORY_META,
    getStatusText,
    getStatusStyles,
    getCategoryCardStyles,
    getCategoryIcon,
    buildCompareReport
} from './comparePageHelpers';

interface Props {
    plots: Plot[];
    crops: CropProfile[];
    logs: DailyLog[];
    onBack: () => void;
}

export const ComparePage: React.FC<Props> = ({ plots = [], crops = [], logs = [], onBack }) => {
    // T-IGH-04-LINT-RATCHET — react-hooks/rules-of-hooks: every hook must run on
    // every render. Hoist them above the empty-state early-return guards.
    const [selectedCropId, setSelectedCropId] = useState<string>(crops[0]?.id || '');
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
    const [isScheduleReplicaOpen, setIsScheduleReplicaOpen] = useState<boolean>(false);
    const [showAllReplicaDays, setShowAllReplicaDays] = useState<boolean>(false);
    const [moneyLensOpen, setMoneyLensOpen] = useState(false);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters>({});

    useEffect(() => {
        const crop = crops.find(c => c.id === selectedCropId);
        if (crop && crop.plots.length > 0) {
            setSelectedPlotIds([crop.plots[0].id]);
        } else {
            setSelectedPlotIds([]);
        }
    }, [selectedCropId, crops]);

    const activePlotId = selectedPlotIds[0] || null;
    const activeCrop = crops.find(c => c.id === selectedCropId);
    const activePlot = activeCrop?.plots.find(p => p.id === activePlotId);
    const baselineSchedule = getScheduleById(activeCrop?.activeScheduleId || '')
        || getScheduleById(activePlot?.schedule?.templateId || '');

    const comparisonData = useMemo(() => {
        if (!activePlotId) return null;

        const plot = plots.find(p => p.id === activePlotId);
        if (!plot) return null;

        const crop = crops.find(c => c.plots.some(p => p.id === plot.id));
        if (!crop) return null;

        try {
            return generatePlotComparison(plot, crop, logs);
        } catch (e) {
            console.error('Error generating comparison:', e);
            return null;
        }
    }, [activePlotId, plots, crops, logs]);

    const plotLogs = useMemo(() => {
        if (!activePlotId) return [];
        return logs.filter(log => log.context.selection.some(sel => sel.selectedPlotIds.includes(activePlotId)));
    }, [activePlotId, logs]);

    const report = useMemo(() => {
        if (!comparisonData || !activePlot) return null;
        return buildCompareReport(comparisonData, activePlot, plotLogs);
    }, [comparisonData, activePlot, plotLogs]);

    const compareCost = useMemo(() => {
        if (!report) return null;
        const actual = financeSelectors.getTotalCost({
            cropId: activeCrop?.id,
            plotId: activePlot?.id
        });
        const plannedEstimate = report.plannedCount > 0
            ? Math.round((actual / Math.max(1, report.doneCount || 1)) * report.plannedCount)
            : 0;
        return {
            plannedEstimate,
            actual,
            delta: actual - plannedEstimate
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    }, [report, activeCrop?.id, activePlot?.id, logs.length]);

    const statusStyles = report ? getStatusStyles(report.status) : null;

    // Empty-state guards (formerly above the hooks; moved here to preserve
    // hook-call order). Render-time conditionals only — no hook calls below.
    if (!crops || crops.length === 0) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
                <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-full bg-white shadow-sm">
                    <ArrowLeft className="w-6 h-6 text-gray-700" />
                </button>
                <p className="text-gray-500 font-medium">No crop data available.</p>
            </div>
        );
    }

    if (!logs || logs.length === 0) {
        return (
            <div className="min-h-screen bg-[#F8F6F1] p-4 sm:p-6">
                <button
                    onClick={onBack}
                    className="mb-5 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 shadow-sm"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <div className="mx-auto max-w-xl rounded-3xl border-2 border-dashed border-stone-300 bg-white p-8 text-center shadow-sm">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                        <GitCompare className="h-8 w-8" />
                    </div>
                    <h2 className="text-xl font-black text-stone-900">Nothing to Compare</h2>
                    <p className="mt-2 text-sm font-medium text-stone-600">
                        Log some activities first. Compare shows planned vs actual work.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="pb-24 max-w-4xl mx-auto px-4 sm:px-6 py-6 font-sans">
            <div className="mb-6 flex items-center gap-3">
                <button onClick={onBack} className="p-2 rounded-full bg-white shadow-sm hover:bg-stone-50 transition-colors">
                    <ArrowLeft className="w-5 h-5 text-stone-700" />
                </button>
                <h1 className="text-xl font-black text-stone-800 tracking-tight">Today&apos;s Report Card</h1>
            </div>

            <div className="mb-6">
                <SlidingCropSelector
                    crops={crops}
                    selectedCropId={selectedCropId}
                    selectedPlotIds={selectedPlotIds}
                    onCropSelect={setSelectedCropId}
                    onPlotSelect={(plotId) => setSelectedPlotIds([plotId])}
                    mode="single"
                />
            </div>

            {activePlot && !baselineSchedule && (
                <div className="text-center py-12 px-6 border-2 border-dashed border-amber-200 rounded-3xl bg-amber-50/50">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4 mx-auto">
                        <ShieldAlert className="w-8 h-8 text-amber-500" />
                    </div>
                    <p className="text-amber-800 font-black text-lg mb-2">No Schedule Adopted</p>
                    <p className="text-amber-600 text-sm mb-4 max-w-sm mx-auto">
                        Compare needs an active schedule.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-amber-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm">
                        <BookOpen size={16} />
                        <span>Go to Schedule Page</span>
                    </div>
                </div>
            )}

            {!comparisonData || !report || !statusStyles ? (
                <div className="text-center py-12 px-6 border-2 border-dashed border-stone-200 rounded-3xl bg-stone-50/60">
                    <p className="text-gray-500 font-medium">Select a crop and plot to view compare.</p>
                </div>
            ) : (
                <div className="space-y-5">
                    <section className={`rounded-3xl border p-5 ${statusStyles.card}`}>
                        <p className="text-[11px] uppercase tracking-wider font-black text-stone-500 mb-2">Where You Are Now</p>
                        <p className="text-lg font-black text-stone-900">{report.stageName}</p>
                        <p className="text-xs font-semibold text-stone-600 mt-1">
                            Crop: {activeCrop?.name} | Plot: {activePlot?.name}
                        </p>
                        <p className="text-sm font-semibold text-stone-700 mt-1">
                            Season Day {report.seasonDay} | Phase Day {report.stageDay}
                        </p>

                        <div className="mt-3">
                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wide ${statusStyles.chip}`}>
                                {getStatusText(report.status)}
                            </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
                                <p className="text-[11px] font-bold uppercase text-emerald-700">Right</p>
                                <p className="text-xl font-black text-emerald-800 mt-1">{report.doneCount}</p>
                            </div>
                            <div className="rounded-2xl border border-red-200 bg-white p-3">
                                <p className="text-[11px] font-bold uppercase text-red-700">Missed</p>
                                <p className="text-xl font-black text-red-800 mt-1">{report.missedCount}</p>
                            </div>
                            <div className="rounded-2xl border border-blue-200 bg-white p-3">
                                <p className="text-[11px] font-bold uppercase text-blue-700">Extra</p>
                                <p className="text-xl font-black text-blue-800 mt-1">{report.extraCount}</p>
                            </div>
                            <div className="rounded-2xl border border-cyan-200 bg-white p-3">
                                <p className="text-[11px] font-bold uppercase text-cyan-700 flex items-center gap-1">
                                    <Droplets size={12} /> Water
                                </p>
                                <p className="text-sm font-black text-cyan-900 mt-1">
                                    {report.actualWaterHours}/{report.expectedWaterHours} hrs
                                </p>
                                <p className="text-xs text-cyan-800 mt-1">Gap {report.waterGapHours} hrs</p>
                            </div>
                        </div>

                        {compareCost && (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                                <p className="text-[11px] font-black uppercase text-amber-800">Cost Delta (Planned vs Executed)</p>
                                <p className="mt-1 text-sm font-bold text-amber-900">
                                    Planned Rs {compareCost.plannedEstimate.toLocaleString('en-IN')} •
                                    Actual Rs {compareCost.actual.toLocaleString('en-IN')} •
                                    Delta Rs {compareCost.delta.toLocaleString('en-IN')}
                                </p>
                                <div className="mt-2">
                                    <MoneyChip
                                        amount={compareCost.actual}
                                        onClick={() => {
                                            setMoneyLensFilters({
                                                cropId: activeCrop?.id,
                                                plotId: activePlot?.id
                                            });
                                            setMoneyLensOpen(true);
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="bg-white rounded-3xl border border-stone-200 p-5 shadow-sm">
                        <h2 className="text-lg font-black text-stone-900">Where You Are Behind (By Category)</h2>
                        <p className="text-xs text-stone-600 mt-1">See exactly if Activities, Nutrition, Sprays or Water is behind.</p>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {report.categoryCards.map(card => (
                                <div key={card.category} className={`rounded-2xl border p-4 ${getCategoryCardStyles(card.health)}`}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            {getCategoryIcon(card.category, 16, 'text-stone-700')}
                                            <p className="text-sm font-black text-stone-900">{card.label}</p>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${card.health === 'BEHIND'
                                            ? 'bg-red-600 text-white'
                                            : card.health === 'EXTRA'
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-emerald-600 text-white'
                                            }`}>
                                            {card.health === 'BEHIND' ? 'Behind' : card.health === 'EXTRA' ? 'Extra' : 'On Track'}
                                        </span>
                                    </div>

                                    <p className="text-xs font-semibold text-stone-700 mt-2">
                                        Done {card.doneCount} | Missed {card.missedCount} | Extra {card.extraCount}
                                    </p>

                                    {card.biggestMisses.length > 0 && (
                                        <p className="text-xs text-red-700 font-semibold mt-2">
                                            Missed: {card.biggestMisses.join(', ')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="bg-white rounded-3xl border border-stone-200 p-5 shadow-sm">
                        <h2 className="text-lg font-black text-stone-900">This Phase Checklist by Category</h2>
                        <p className="text-xs text-stone-600 mt-1">Green tick means right. Red X means missed.</p>

                        <div className="mt-4 space-y-4">
                            {CATEGORY_ORDER.map(category => {
                                const items = report.mustDoItems.filter(item => item.category === category);
                                if (items.length === 0) return null;

                                const done = items.filter(item => item.isDone).length;
                                const missed = items.length - done;

                                return (
                                    <div key={category} className="rounded-2xl border border-stone-200 overflow-hidden">
                                        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {getCategoryIcon(category, 15, 'text-stone-700')}
                                                <p className="text-sm font-black text-stone-900">{CATEGORY_META[category].label}</p>
                                            </div>
                                            <p className="text-xs font-bold text-stone-700">Done {done} | Missed {missed}</p>
                                        </div>

                                        <div className="p-3 space-y-2">
                                            {items.map(item => (
                                                <div
                                                    key={item.id}
                                                    className={`rounded-xl border p-3 ${item.isDone
                                                        ? 'border-emerald-200 bg-emerald-50/50'
                                                        : 'border-red-200 bg-red-50/60'}`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <div className="pt-0.5">
                                                            {item.isDone
                                                                ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                                                : <XCircle className="w-5 h-5 text-red-600" />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className={`text-sm font-black ${item.isDone ? 'text-emerald-900' : 'text-red-900'}`}>
                                                                {item.name}
                                                            </p>
                                                            <p className="text-xs text-stone-600 mt-1">{item.plannedText}</p>
                                                            <p className={`text-xs font-semibold mt-1 ${item.isDone ? 'text-emerald-700' : 'text-red-700'}`}>
                                                                {item.actualText}
                                                            </p>
                                                            {!item.isDone && (
                                                                <p className="text-xs font-bold text-red-700 mt-2">Do this now</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className="bg-white rounded-3xl border border-stone-200 p-5 shadow-sm">
                        <button
                            type="button"
                            onClick={() => setIsScheduleReplicaOpen(prev => !prev)}
                            className="w-full flex items-center justify-between gap-3"
                        >
                            <div className="text-left">
                                <p className="text-lg font-black text-stone-900 flex items-center gap-2">
                                    <CalendarDays size={18} className="text-stone-700" />
                                    Schedule View with Your Work
                                </p>
                                <p className="text-xs text-stone-600 mt-1">
                                    Same schedule UI. Missed stays on that day. Extra is marked on exact day.
                                </p>
                                <p className="text-[11px] font-semibold text-stone-500 mt-1">
                                    Phase days {report.stageStartDay + 1} to {report.stageEndDay + 1}
                                </p>
                            </div>
                            {isScheduleReplicaOpen
                                ? <ChevronUp className="w-5 h-5 text-stone-600" />
                                : <ChevronDown className="w-5 h-5 text-stone-600" />}
                        </button>

                        {isScheduleReplicaOpen && (
                            <div className="mt-4 space-y-3">
                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                                    <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">Done (Green)</span>
                                    <span className="px-2 py-1 rounded-full bg-red-100 text-red-800">Missed (Red)</span>
                                    <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800">Extra (Blue strip)</span>
                                    <span className="px-2 py-1 rounded-full bg-stone-100 text-stone-700">Planned (Upcoming)</span>
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[11px] text-stone-600 font-semibold">
                                        Showing {showAllReplicaDays ? report.scheduleDays.length : report.compactScheduleDays.length} day rows
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setShowAllReplicaDays(prev => !prev)}
                                        className="text-[11px] font-black uppercase tracking-wide text-stone-700 bg-stone-100 hover:bg-stone-200 px-2.5 py-1 rounded-lg transition-colors"
                                    >
                                        {showAllReplicaDays ? 'Show Compact' : 'Show All Days'}
                                    </button>
                                </div>

                                <div className="rounded-2xl border border-stone-200 overflow-y-auto max-h-[58vh]">
                                    <div className="sticky top-0 z-20 bg-[#FDFBF7] py-2 border-b-2 border-stone-800 flex flex-col shadow-sm gap-1">
                                        <div className="flex items-center justify-between px-2">
                                            <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest font-mono">
                                                {report.stageName}
                                            </h3>
                                            <div className="text-[10px] font-bold text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full font-mono">
                                                DAYS {report.stageStartDay + 1} - {report.stageEndDay + 1}
                                            </div>
                                        </div>
                                        <div className="px-2">
                                            <p className="text-[10px] text-stone-600 font-medium bg-yellow-50/50 border-l-2 border-yellow-400 pl-2 py-1 italic leading-tight rounded-r">
                                                <span className="font-bold text-yellow-600 not-italic mr-1">Compare note:</span>
                                                Same schedule view with your exact execution marks.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex border-b border-stone-300 bg-stone-50 text-[9px] font-bold text-stone-400 uppercase tracking-wider py-1.5 sticky top-[57px] z-10 shadow-sm">
                                        <div className="w-24 text-center border-r border-stone-200">Day / Date</div>
                                        <div className="flex-1 grid grid-cols-4 divide-x divide-stone-200">
                                            <div className="text-center text-blue-400">Water</div>
                                            <div className="text-center text-emerald-400">Nutri</div>
                                            <div className="text-center text-rose-400">Spray</div>
                                            <div className="text-center text-amber-400">Work</div>
                                        </div>
                                    </div>

                                    <div className="border-l-4 border-l-stone-800 ml-0.5">
                                        {(showAllReplicaDays ? report.scheduleDays : report.compactScheduleDays).map(day => (
                                            <div
                                                key={day.key}
                                                className={`border-b border-stone-200 last:border-b-0 ${day.missedEntries.length > 0 ? 'border-l-4 border-l-red-500 bg-red-50/20' : ''}`}
                                            >
                                                <DayCard
                                                    dayNumber={day.dayNumber}
                                                    dayType="CYCLE"
                                                    dateLabel={day.dateLabel}
                                                    isToday={day.isToday}
                                                    isPast={day.isPast}
                                                    status={day.status}
                                                    notes={day.notes}
                                                    onTapBlock={() => undefined}
                                                    dayColumnWidthClass="w-24"
                                                    dayNumberTextClass="text-3xl"
                                                    dateLabelTextClass="text-[12px]"
                                                    compact
                                                />

                                                {(day.missedEntries.length > 0 || day.extraEntries.length > 0) && (
                                                    <div className="ml-24 border-t border-stone-200 bg-stone-50/70 px-3 py-2">
                                                        <div className="space-y-1">
                                                            {day.missedEntries.map((entry, index) => (
                                                                <p key={`${day.key}_missed_${index}`} className="text-[11px] font-semibold text-red-700">
                                                                    X {entry}
                                                                </p>
                                                            ))}
                                                            {day.extraEntries.map((entry, index) => (
                                                                <p key={`${day.key}_extra_${index}`} className="text-[11px] font-semibold text-blue-700">
                                                                    + {entry}
                                                                </p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="bg-white rounded-3xl border border-stone-200 p-5 shadow-sm">
                        <h2 className="text-lg font-black text-stone-900">Extra Work Done</h2>
                        <p className="text-xs text-stone-600 mt-1">Extra action is shown with reason.</p>

                        <div className="mt-4 space-y-2">
                            {report.extraItems.length === 0 ? (
                                <div className="rounded-xl border border-stone-200 p-4 text-sm text-stone-500">
                                    No extra work in this phase.
                                </div>
                            ) : report.extraItems.map(item => (
                                <div key={item.id} className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                                    <div className="flex items-start gap-3">
                                        <div className="pt-0.5">
                                            <PlusCircle className="w-5 h-5 text-blue-600" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-black text-blue-900">{item.name}</p>
                                            <p className="text-xs text-blue-800 mt-1">{item.doneText}</p>
                                            <p className="text-xs font-semibold text-blue-700 mt-1">{item.reasonText}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
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
