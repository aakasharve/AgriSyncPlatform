import React from 'react';
import { Droplets, Sprout, SprayCan, CheckCircle2, AlertTriangle, XCircle, Minus, Hammer, AlertCircle, Thermometer, Cloud, Wind } from 'lucide-react';
import { formatTemperature, formatHumidity } from '../../../shared/utils/weatherFormatter';


export type BlockStatus = 'DONE' | 'MISSED' | 'PENDING' | 'PLANNED' | 'NOT_REQUIRED';

export interface DayCardProps {
    dayNumber: number;
    dateLabel: string; // e.g. "16 Oct"
    isToday: boolean;
    status: {
        irrigation: BlockStatus;
        nutrition: BlockStatus;
        spray: BlockStatus;
        activity: BlockStatus;
    };
    notes?: {
        irrigation?: string;
        nutrition?: string;
        spray?: string;
        activity?: string;
        general?: string;
    };
    onTapBlock: (block: 'IRRIGATION' | 'NUTRITION' | 'SPRAY' | 'ACTIVITY') => void;
    weatherContext?: {
        iconCode: string;
        tempC: number;
        conditionText: string;
        isSevere: boolean;
        humidity?: number;
        windKph?: number;
        cloudCover?: number;
    };
    dayColumnWidthClass?: string;
    dayNumberTextClass?: string;
    dateLabelTextClass?: string;
    compact?: boolean;
}

const NotebookCell = ({
    icon: Icon,
    status,
    note,
    onClick,
    colorClass,
    compact = false
}: {
    icon: any,
    status: BlockStatus,
    note?: string,
    onClick: () => void,
    colorClass: string,
    compact?: boolean
}) => {
    // Notebook Cell Logic
    const isEmpty = status === 'NOT_REQUIRED' && !note;
    const isDone = status === 'DONE';

    if (isEmpty) {
        return (
            <div className={`h-full ${compact ? 'min-h-[44px]' : 'min-h-[60px]'} flex items-center justify-center opacity-10 border-r border-stone-100 border-dashed last:border-r-0`}>
                <div className="w-1 h-1 rounded-full bg-stone-300" />
            </div>
        );
    }

    return (
        <button
            onClick={onClick}
            className={`h-full ${compact ? 'min-h-[44px] p-1.5' : 'min-h-[60px] p-2'} w-full flex flex-col justify-start items-start gap-1 transition-colors relative group hover:bg-stone-50/80 outline-none border-r border-stone-100 border-dashed last:border-r-0`}
        >
            {/* Icon Status */}
            <div className={`relative z-10 mb-1 ${isDone ? 'text-emerald-600' : note ? colorClass : 'text-stone-300'}`}>
                {isDone ? <CheckCircle2 size={16} className="stroke-[2.5]" /> : <Icon size={16} />}
            </div>

            {/* Text Content */}
            <div className="w-full text-left">
                {note ? (
                    <div className="text-[10px] font-bold text-stone-700 leading-tight break-words font-mono whitespace-pre-wrap">
                        {note}
                    </div>
                ) : (
                    <div className={`text-[9px] uppercase font-bold tracking-widest ${isDone ? 'text-emerald-600' : 'text-stone-300 opacity-60'}`}>
                        {status === 'PLANNED' ? 'STD' : status}
                    </div>
                )}
            </div>

            {/* Intervention Dot */}
            {note && !isDone && (
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse absolute top-2 right-2" />
            )}
        </button>
    );
};

const DayCard: React.FC<DayCardProps & { isPast?: boolean, dayType?: 'CYCLE' | 'PREP' }> = ({
    dayNumber,
    dateLabel,
    isToday,
    status,
    notes,
    onTapBlock,
    isPast,
    dayType = 'CYCLE',
    weatherContext,
    dayColumnWidthClass,
    dayNumberTextClass,
    dateLabelTextClass,
    compact = false
}) => {

    // Styling Logic
    const isPrep = dayType === 'PREP';
    const isCyclePast = isPast && !isToday && !isPrep;

    // Stronger Prep Brown (Coffee/Amber), Clean White for Past, Green Tint for Today
    const bgClass = isToday ? 'bg-emerald-50/30' : isPrep ? 'bg-[#FFF8E7]' : 'bg-white';
    const borderClass = isPrep ? 'border-amber-200' : 'border-stone-200';

    // Date Column Background for Past Cycle Days -> Visual Cue for "Done"
    const dateColBg = isCyclePast ? 'bg-emerald-50' : '';

    // Text Coloring
    const dateTextClass = isToday ? 'text-emerald-700' : isPrep ? 'text-amber-800' : isCyclePast ? 'text-emerald-700' : 'text-stone-500';
    const labelTextClass = isPrep ? 'text-amber-700' : 'text-stone-400';

    return (
        <div className={`flex items-stretch relative border-b ${borderClass} ${bgClass}`}>

            {/* Past Day "Tick" Overlay - LARGE Watermark */}
            {isCyclePast && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-10">
                    <CheckCircle2 size={48} className="text-emerald-600" />
                </div>
            )}

            {/* Date Column (Fixed Width) */}
            <div className={`${dayColumnWidthClass || 'w-16'} flex flex-col items-center justify-center border-r border-double ${borderClass} pr-1 ${compact ? 'py-1' : 'py-1.5'} ${dateTextClass} ${dateColBg} relative`}>
                {/* Past Indicator (Small Tick) */}
                {isCyclePast && (
                    <div className="absolute top-1 left-1">
                        <CheckCircle2 size={12} className="text-emerald-600 fill-white" />
                    </div>
                )}

                <span className={`text-[8px] uppercase font-black tracking-widest leading-none mb-0.5 ${labelTextClass}`}>
                    {dayType === 'PREP' ? 'PREP' : 'DAY'}
                </span>
                <span className={`${dayNumberTextClass || (compact ? 'text-lg' : 'text-xl')} font-black font-mono leading-none tracking-tight`}>{dayNumber}</span>
                <span className={`${dateLabelTextClass || 'text-[9px]'} uppercase font-bold opacity-60 mt-1`}>{dateLabel}</span>
            </div>

            {/* Notebook Cells & Note Wrapper */}
            <div className="flex-1 flex flex-col min-w-0">
                <div className={`grid grid-cols-4 divide-x flex-1 ${isPrep ? 'divide-amber-200/50' : 'divide-stone-100/50'}`}>
                    <NotebookCell icon={Droplets} status={status.irrigation} note={notes?.irrigation} onClick={() => onTapBlock('IRRIGATION')} colorClass="text-blue-500" compact={compact} />
                    <NotebookCell icon={Sprout} status={status.nutrition} note={notes?.nutrition} onClick={() => onTapBlock('NUTRITION')} colorClass="text-emerald-500" compact={compact} />
                    <NotebookCell icon={SprayCan} status={status.spray} note={notes?.spray} onClick={() => onTapBlock('SPRAY')} colorClass="text-rose-500" compact={compact} />
                    <NotebookCell icon={Hammer} status={status.activity} note={notes?.activity} onClick={() => onTapBlock('ACTIVITY')} colorClass="text-amber-500" compact={compact} />
                </div>

                {/* Weather Footer (Premium Aesthetic) */}
                {weatherContext && (
                    <div className={`
                        px-3 py-1.5 flex items-center justify-between gap-3 text-[10px] font-medium border-t border-stone-100
                        ${weatherContext.isSevere ? 'bg-orange-50/50 text-orange-800' : 'bg-stone-50/50 text-stone-500'}
                    `}>
                        <div className="flex items-center gap-3">
                            {/* Temp */}
                            <div className="flex items-center gap-1 min-w-[50px]">
                                <Thermometer size={12} className="opacity-60" />
                                <span className="font-bold">{formatTemperature(weatherContext.tempC)}</span>
                            </div>

                            {/* Humidity */}
                            {weatherContext.humidity !== undefined && (
                                <div className="flex items-center gap-1 min-w-[50px]">
                                    <Droplets size={12} className="opacity-60" />
                                    <span>{formatHumidity(weatherContext.humidity)}</span>
                                </div>
                            )}

                            {/* Cloud/Wind */}
                            {weatherContext.cloudCover !== undefined && weatherContext.cloudCover > 0 && (
                                <div className="flex items-center gap-1">
                                    <Cloud size={12} className="opacity-60" />
                                    <span>{weatherContext.cloudCover}%</span>
                                </div>
                            )}
                        </div>

                        {/* Condition Text */}
                        <div className="uppercase tracking-wide text-[9px] font-bold opacity-70">
                            {weatherContext.conditionText}
                        </div>
                    </div>
                )}

                {notes?.general && (
                    <div className="bg-yellow-50/50 border-t border-yellow-100 px-2 py-1 text-[10px] font-medium text-stone-600 flex items-center gap-2">
                        <AlertCircle size={10} className="text-yellow-600 flex-shrink-0" />
                        <span className="truncate">{notes.general}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DayCard;
