/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import {
    Calendar, ChevronRight, ChevronLeft, CloudRain, LayoutList, Grid3X3
} from 'lucide-react';
import { DailyLog } from '../../logs/logs.types';
import { CropProfile } from '../../../types';
import { CropSymbol, PlotMarker } from '../../context/components/CropSelector';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import AccordionBlock from '../components/AccordionBlock';
import { isSameDate, getDisturbanceIcon, getPrimaryActivityName } from '../helpers';

interface ActivityCalendarSectionProps {
    history: DailyLog[];
    crops: CropProfile[];
    viewPlots: Record<string, string[]>;
    currentDate: Date;
    setCurrentDate: (d: Date) => void;
    calendarViewDate: Date;
    setCalendarViewDate: (d: Date) => void;
    calendarMode: 'week' | 'month';
    setCalendarMode: (m: 'week' | 'month') => void;
    isOpen: boolean;
    onToggle: () => void;
}

const ActivityCalendarSection: React.FC<ActivityCalendarSectionProps> = ({
    history,
    crops,
    viewPlots,
    currentDate,
    setCurrentDate,
    calendarViewDate,
    setCalendarViewDate,
    calendarMode,
    setCalendarMode,
    isOpen,
    onToggle,
}) => {
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

    return (
        <AccordionBlock
            title="Activity Calendar"
            icon={<Calendar size={20} />}
            isOpen={isOpen}
            onToggle={onToggle}
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
                        {calendarDays.map((date, _i) => {
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
    );
};

export default ActivityCalendarSection;
