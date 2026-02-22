import React, { useMemo, useEffect, useState } from 'react';
import { Plot, DailyLog } from '../../../types';
import DayCard, { BlockStatus } from './DayCard';
import { calculateEffectiveDay } from '../../../shared/utils/timelineUtils';
import { FileEdit, ArrowLeft } from 'lucide-react';
import ScheduleDetailModal from './ScheduleDetailModal';
import { getDateKey } from '../../../core/domain/services/DateKeyService';

import {
    getTemplateForCrop,
    derivePlannedItemsForDay,
    PlannedTaskDerived,
    getOperationCategory,
    getEffectiveStartDate
} from '../../../features/scheduler/planning/ClientPlanEngine';

interface SchedulerTimelineProps {
    plot: Plot;
    logs: DailyLog[];
    onEditLog: (date: string) => void;
    onEditSchedule: () => void;
}

const SchedulerTimeline: React.FC<SchedulerTimelineProps> = ({ plot, logs, onEditLog, onEditSchedule }) => {

    const instance = plot.schedule;

    // Generate Timeline Data using PlanEngine
    const timelineData = useMemo(() => {
        const startDate = getEffectiveStartDate(plot);
        if (!startDate) return [];

        // Get Template via PlanEngine
        // Assuming plot has a crop name or we need to look it up. 
        // Plot doesn't always have crop name directly attached in valid format for lookup if it's not passed.
        // But createInitialScheduleInstance in SchedulerPage passed 'activeCrop.name'.
        // If plot.schedule exists, it has templateId. We might need to look up crop name from that or context.
        // For now, let's assume SchedulerPage ensured plot.schedule is valid or we fallback.
        // Accessing crop name is tricky if not in props. 
        // HACK: SchedulerPage passes fully hydrated plot? No. 
        // We will try to infer or use a prop if available. 
        // Actually, internal `schedulerUtils` `getTemplateForCrop` works on string.
        // `plot.schedule.templateId` usually contains crop code e.g. `tpl_tomato_v1`.

        // Let's rely on the fact that for now we are running single crop context usually.
        // If strictly provided, better. But let's try to extract from templateId or fallback.
        // The master implementation roadmap implies we should have this.
        // Let's use a safe fallback or extraction.
        let cropCode = 'generic';
        if (instance?.templateId) {
            if (instance.templateId.includes('tomato')) cropCode = 'Tomato';
            else if (instance.templateId.includes('grape')) cropCode = 'Grape'; // Case sensitive in utils?
            else if (instance.templateId.includes('pom')) cropCode = 'Pomegranate';
            else if (instance.templateId.includes('onion')) cropCode = 'Onion';
            else if (instance.templateId.includes('sugarcane')) cropCode = 'Sugarcane';
        }

        const template = getTemplateForCrop(cropCode);
        // Ideally we should pass 'crop' object to this component to be safe.
        // But let's proceed with this heuristic for Phase 1 to avoid breaking Props interface everywhere yet.

        const today = new Date();
        const oneDay = 1000 * 60 * 60 * 24;

        // Determine Current Day Index to optimize view
        const diffTime = today.getTime() - startDate.getTime();
        const currentDayIndex = Math.floor(diffTime / oneDay);

        // Dynamic Start
        const START_DAY = currentDayIndex > 10 ? currentDayIndex - 7 : -15;
        const END_DAY = 240;

        const days = [];

        // Helper to group PlanItems into UI Categories
        const groupItems = (items: PlannedTaskDerived[]) => {
            const groups = {
                irrigation: [] as PlannedTaskDerived[],
                nutrition: [] as PlannedTaskDerived[],
                spray: [] as PlannedTaskDerived[],
                activity: [] as PlannedTaskDerived[]
            };

            items.forEach(item => {
                const cat = item.category;
                if (cat === 'IRRIGATION') groups.irrigation.push(item);
                else if (cat === 'FERTIGATION') groups.nutrition.push(item);
                else if (cat === 'FOLIAR_SPRAY') groups.spray.push(item);
                else groups.activity.push(item); // Catch-all: WEED, PRUNING, HARVEST, CULTURAL, OTHER
            });

            // Format for UI (text + details)
            const format = (list: PlannedTaskDerived[]) => {
                if (list.length === 0) return null;
                return {
                    text: list.map(i => i.name).join(', '), // Summary text
                    items: list, // Full details for modal
                    notes: list.map(i => i.notes).filter(Boolean).join('; ')
                };
            };

            return {
                irrigation: format(groups.irrigation),
                nutrition: format(groups.nutrition),
                spray: format(groups.spray),
                activity: format(groups.activity)
            };
        };


        for (let d = START_DAY; d <= END_DAY; d++) {
            const currentDate = new Date(startDate.getTime() + (d * oneDay));
            const dateStr = getDateKey(currentDate);
            const isToday = dateStr === getDateKey(today);
            const isFuture = currentDate > today && !isToday;
            const isPast = currentDate < today && !isToday;

            // ADAPTIVE TIMELINE: 
            // We use calculateEffectiveDay to determine which "Plan Day" fits this "Calendar Date"
            // honoring the schedule shifts.
            const { effectiveDay } = calculateEffectiveDay(plot, currentDate);

            // 1. Get Plan from Engine
            // PlanEngine expects dayNumber. If items strictly map to integers.
            // effectiveDay is 1-based usually. PlanEngine logic (dayNumber) should match structure.
            // Templates use 0-based or 1-based?
            // schedulerUtils factories use dayStart: 0.. etc.
            // derivedPlannedItemsForDay logic needs to align.
            // Let's assume dayNumber passed to engine is the effective cycle age.
            // For PREP days (negative), engine returns nothing usually unless template has prep stages (future).
            const dailyPlan = derivePlannedItemsForDay(template, instance!, effectiveDay);

            const plannedGroups = groupItems(dailyPlan.plannedItems);
            const stageName = dailyPlan.stage?.name || 'Unknown Stage';
            const stageNote = dailyPlan.stage?.description || ''; // Use description or leave blank

            // 2. Get Actual Log
            const dayLog = logs.find(l => l.context.selection.some(s => s.selectedPlotIds.includes(plot.id)) && l.date.split('T')[0] === dateStr);

            // 3. Status Resolution
            const resolveBlock = (category: 'irrigation' | 'nutrition' | 'spray' | 'activity'): { status: BlockStatus, note?: string, detail?: any } => {
                const planGroup = plannedGroups[category];

                let isDone = false;
                if (dayLog) {
                    if (category === 'irrigation' && dayLog.irrigation?.length > 0) isDone = true;
                    if (category === 'nutrition' && dayLog.inputs?.some(i => i.type === 'fertilizer')) isDone = true;
                    if (category === 'spray' && (dayLog.inputs?.some(i => i.type === 'pesticide' || i.type === 'fungicide') || dayLog.cropActivities?.some(a => a.title.toLowerCase().includes('spray')))) isDone = true;
                    if (category === 'activity' && (dayLog.cropActivities?.length > 0 || dayLog.labour?.length > 0)) isDone = true;
                }

                if (isDone) return { status: 'DONE', note: planGroup?.text, detail: planGroup };

                if (planGroup) {
                    return { status: isFuture ? 'PLANNED' : 'PENDING', note: planGroup.text, detail: planGroup };
                }

                return { status: 'NOT_REQUIRED' };
            };

            const irrig = resolveBlock('irrigation');
            const fert = resolveBlock('nutrition');
            const spray = resolveBlock('spray');
            const activ = resolveBlock('activity');

            // Force Activity DONE catch-all
            if (dayLog && (dayLog.cropActivities?.length > 0 || dayLog.labour?.length > 0) && activ.status !== 'DONE') {
                activ.status = 'DONE';
            }

            // Weather Context Logic (Existing)
            let weatherContext: any = undefined;
            if (dayLog) {
                // ... existing logic ...
                if (dayLog.weatherStamp) {
                    const ws = dayLog.weatherStamp;
                    weatherContext = {
                        tempC: ws.tempC,
                        conditionText: ws.conditionText,
                        iconCode: ws.iconCode,
                        humidity: ws.humidity,
                        windKph: ws.windKph,
                        cloudCover: ws.cloudCoverPct,
                        isSevere: (ws.precipMm > 15 || (ws.windKph > 40))
                    };
                } else if (dayLog.weatherSnapshot?.current) {
                    const ws = dayLog.weatherSnapshot.current;
                    weatherContext = {
                        tempC: ws.tempC,
                        conditionText: ws.conditionText,
                        iconCode: ws.iconCode,
                        humidity: ws.humidity,
                        windKph: ws.windKph,
                        cloudCover: 0,
                        isSevere: (ws.precipMm > 15 || (ws.windKph > 40))
                    };
                }
            }

            // Day Display Logic
            const isPrep = d < 0;
            const displayDayNumber = isPrep ? (d + 16) : (d + 1);
            const dateLabelFormatted = currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

            days.push({
                dayNumber: displayDayNumber,
                dayType: isPrep ? 'PREP' : 'CYCLE',
                date: currentDate,
                dateLabel: dateLabelFormatted,
                isToday,
                isPast,
                stage: { name: stageName, note: stageNote },
                status: {
                    irrigation: irrig.status,
                    nutrition: fert.status,
                    spray: spray.status,
                    activity: activ.status
                },
                notes: {
                    irrigation: irrig.note,
                    nutrition: fert.note,
                    spray: spray.note,
                    activity: activ.note,
                    general: ''
                },
                details: {
                    irrigation: irrig.detail,
                    nutrition: fert.detail,
                    spray: spray.detail,
                    activity: activ.detail
                },
                dayLog,
                weatherContext
            });
        }

        // Grouping by Stage
        const groups = [];
        let currentGroup = null;
        for (const item of days) {
            const stageName = item.stage.name;
            if (!currentGroup || currentGroup.stageShort !== stageName) {
                currentGroup = { stageShort: stageName, stageNote: item.stage.note, days: [] };
                groups.push(currentGroup);
            }
            currentGroup.days.push(item);
        }
        return groups;

    }, [plot.startDate, plot.schedule, logs, plot.id]);

    // Modal State
    const [detailModal, setDetailModal] = useState<any>(null);

    const handleTapBlock = (day: any, category: 'IRRIGATION' | 'NUTRITION' | 'SPRAY' | 'ACTIVITY') => {
        const catKey = category.toLowerCase() as 'irrigation' | 'nutrition' | 'spray' | 'activity';
        const detail = day.details[catKey];
        const status = day.status[catKey];

        setDetailModal({
            dateLabel: day.dateLabel,
            dayNumber: day.dayNumber,
            category,
            status,
            note: detail?.text,      // Main text
            baseline: detail?.notes, // Subtext -> Notes
            logData: day.dayLog
        });
    };

    // Auto-scroll to Today
    useEffect(() => {
        setTimeout(() => {
            const todayEl = document.getElementById('scheduler-today-row');
            if (todayEl) {
                todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 500);
    }, [instance]);

    if (!instance) return <div className="p-8 text-center text-stone-400">No schedule active.</div>;

    return (
        <div className="space-y-8 relative">
            <ScheduleDetailModal
                isOpen={!!detailModal}
                onClose={() => setDetailModal(null)}
                data={detailModal}
            />

            <div className="space-y-0 pb-32">
                {timelineData.map((group, gIdx) => (
                    <div key={gIdx} className="relative mb-0">
                        {/* STAGE HEADER (Sticky) */}
                        <div className="sticky top-14 z-20 bg-[#FDFBF7] py-2 border-b-2 border-stone-800 flex flex-col shadow-sm gap-1">
                            <div className="flex items-center justify-between px-2">
                                <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest font-mono">
                                    {group.stageShort}
                                </h3>
                                <div className="text-[10px] font-bold text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full font-mono">
                                    DAYS {group.days[0].dayNumber} - {group.days[group.days.length - 1].dayNumber}
                                </div>
                            </div>
                            {/* Generic Note */}
                            {group.stageNote && (
                                <div className="px-2">
                                    <p className="text-[10px] text-stone-600 font-medium bg-yellow-50/50 border-l-2 border-yellow-400 pl-2 py-1 italic leading-tight rounded-r">
                                        <span className="font-bold text-yellow-600 not-italic mr-1">Note:</span>
                                        {group.stageNote}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* COLUMN HEADERS */}
                        <div className="flex border-b border-stone-300 bg-stone-50 text-[9px] font-bold text-stone-400 uppercase tracking-wider py-1.5 sticky top-[102px] z-10 shadow-sm">
                            <div className="w-14 text-center border-r border-stone-200">Day</div>
                            <div className="flex-1 grid grid-cols-4 divide-x divide-stone-200">
                                <div className="text-center text-blue-400">Water</div>
                                <div className="text-center text-emerald-400">Nutri</div>
                                <div className="text-center text-rose-400">Spray</div>
                                <div className="text-center text-amber-400">Work</div>
                            </div>
                        </div>

                        {/* ROWS */}
                        <div className="border-l-4 border-l-stone-800 ml-0.5">
                            {group.days.map(day => (
                                <div key={day.dayNumber} id={day.isToday ? 'scheduler-today-row' : undefined} className="relative">
                                    {/* TODAY INDICATOR (Floating Right) */}
                                    {day.isToday && (
                                        <div className="absolute right-1 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1 bg-white/90 px-2 py-1 rounded-full shadow-md border border-emerald-100">
                                            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wide">We are here</span>
                                            <ArrowLeft size={16} strokeWidth={3} className="text-emerald-500 animate-pulse" />
                                        </div>
                                    )}
                                    <DayCard
                                        dayNumber={day.dayNumber}
                                        dayType={day.dayType}
                                        dateLabel={day.dateLabel}
                                        isToday={day.isToday}
                                        isPast={day.isPast}
                                        status={day.status}
                                        notes={day.notes}
                                        onTapBlock={(category) => handleTapBlock(day, category)}
                                        weatherContext={day.weatherContext}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {/* Scroll Padding */}
            <div className="h-48" />
        </div>
    );
};

export default SchedulerTimeline;
