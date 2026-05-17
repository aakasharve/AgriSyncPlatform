// spec: voice-diary-e2e-2026-05-17 (D.7)
//
// 30-day horizontal calendar; dot density per day reflects the unified
// count of local + retained clips. Selected day carries an emerald
// border; non-zero days carry up to 3 emerald dots ("+N" beyond).
//
// Evolved from V1 `features/voiceJournal/components/CalendarWithDots.tsx`
// (the V1 file is deleted as part of this envelope). The counts contract
// stays identical — keyed by dateKey (YYYY-MM-DD) so the unified-view
// reducer can merge local Dexie + retained-tier counts into a single map.

import React, { useMemo } from 'react';
import {
    getDateKeyDaysAgo,
    formatDateKeyForDisplay,
} from '../../../core/domain/services/DateKeyService';

interface CalendarWithDotsProps {
    /** dateKey (YYYY-MM-DD) → count of clips that day (local + retained). */
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
        <div
            className="overflow-x-auto pb-1 glass-panel p-4 rounded-3xl"
            data-testid="voice-diary-calendar"
        >
            <div className="flex min-w-max gap-2">
                {days.map(day => {
                    const selected = day.dateKey === selectedDateKey;
                    return (
                        <button
                            key={day.dateKey}
                            type="button"
                            onClick={() => onSelectDate(day.dateKey)}
                            data-testid={`voice-diary-calendar-cell-${day.dateKey}`}
                            data-count={day.count}
                            className={`w-[76px] shrink-0 rounded-2xl border px-3 py-3 text-left transition-colors ${
                                selected
                                    ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                                    : 'border-stone-200 bg-white text-stone-700'
                            }`}
                        >
                            <div className="text-[11px] font-['DM_Sans'] font-bold uppercase text-stone-500">
                                {day.dayLabel}
                            </div>
                            <div className="mt-1 text-sm font-['DM_Sans'] font-bold tabular-nums">
                                {day.dateLabel}
                            </div>
                            <div className="mt-2 flex h-2 items-center gap-1">
                                {day.count > 0 ? (
                                    Array.from({ length: Math.min(day.count, 3) }, (_, index) => (
                                        <span
                                            key={index}
                                            className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                                        />
                                    ))
                                ) : (
                                    <span className="h-1.5 w-1.5 rounded-full bg-stone-200" />
                                )}
                                {day.count > 3 && (
                                    <span className="text-[9px] font-['DM_Sans'] font-bold text-emerald-700">
                                        +{day.count - 3}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default CalendarWithDots;
