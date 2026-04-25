import React, { useMemo } from 'react';
import { getDateKeyDaysAgo, formatDateKeyForDisplay } from '../../../core/domain/services/DateKeyService';

interface CalendarWithDotsProps {
    countsByDate: Record<string, number>;
    selectedDateKey: string;
    onSelectDate: (dateKey: string) => void;
}

const CalendarWithDots: React.FC<CalendarWithDotsProps> = ({
    countsByDate,
    selectedDateKey,
    onSelectDate,
}) => {
    const days = useMemo(() => {
        return Array.from({ length: 30 }, (_, index) => {
            const dateKey = getDateKeyDaysAgo(index);
            return {
                dateKey,
                count: countsByDate[dateKey] ?? 0,
                dayLabel: formatDateKeyForDisplay(dateKey, { weekday: 'short' }),
                dateLabel: formatDateKeyForDisplay(dateKey, { day: 'numeric', month: 'short' }),
            };
        });
    }, [countsByDate]);

    return (
        <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2">
                {days.map(day => {
                    const selected = day.dateKey === selectedDateKey;
                    return (
                        <button
                            key={day.dateKey}
                            onClick={() => onSelectDate(day.dateKey)}
                            className={`w-[76px] shrink-0 rounded-2xl border px-3 py-3 text-left transition-colors ${
                                selected
                                    ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
                                    : 'border-stone-200 bg-white text-stone-700'
                            }`}
                        >
                            <div className="text-[11px] font-black uppercase text-stone-500">{day.dayLabel}</div>
                            <div className="mt-1 text-sm font-black">{day.dateLabel}</div>
                            <div className="mt-2 flex h-2 items-center gap-1">
                                {day.count > 0 ? (
                                    Array.from({ length: Math.min(day.count, 3) }, (_, index) => (
                                        <span key={index} className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                    ))
                                ) : (
                                    <span className="h-1.5 w-1.5 rounded-full bg-stone-200" />
                                )}
                                {day.count > 3 && <span className="text-[9px] font-bold text-emerald-700">+{day.count - 3}</span>}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default CalendarWithDots;
