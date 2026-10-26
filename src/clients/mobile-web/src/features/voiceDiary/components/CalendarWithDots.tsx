// spec: voice-diary-e2e-2026-05-17 (D.7)
//
// Day calendar; dot density per day reflects the unified count of local +
// retained clips. Selected day carries an emerald border; non-zero days carry
// up to 3 emerald dots ("+N" beyond).
//
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, V-3) — recordings are
// kept forever (ruling D9), but this strip offered only the last 30 days, so a
// clip older than that could not be opened. It now shows ONE month (newest day
// first) and pages back month by month, as far as the month of his first
// recording, and forward to this month. The month buttons are only drawn when
// there is somewhere to go (P5: no button that does nothing). Month and day
// names follow his language (Marathi names, ordinary digits).
//
// Evolved from V1 `features/voiceJournal/components/CalendarWithDots.tsx`. The
// counts contract stays identical — keyed by dateKey (YYYY-MM-DD).

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import type { VoiceDiaryLocale } from '../../../i18n/voiceDiaryTranslations';
import { daysOfMonth, formatDayKey as fmt, monthOf, shiftMonth } from '../calendarMonths';

interface CalendarWithDotsProps {
    /** dateKey (YYYY-MM-DD) → count of clips that day (local + retained). */
    countsByDate: Record<string, number>;
    selectedDateKey: string;
    onSelectDate: (dateKey: string) => void;
    /** Month and weekday names in his language; English when omitted (as before). */
    locale?: VoiceDiaryLocale;
}

const CalendarWithDots: React.FC<CalendarWithDotsProps> = ({
    countsByDate,
    selectedDateKey,
    onSelectDate,
    locale = 'en-IN',
}) => {
    const todayKey = getDateKey();
    const shownMonth = monthOf(selectedDateKey) > monthOf(todayKey) ? monthOf(todayKey) : monthOf(selectedDateKey);

    // The month of his first recording: paging back stops there.
    const firstMonth = useMemo(() => {
        const withClips = Object.keys(countsByDate).filter(k => (countsByDate[k] ?? 0) > 0).sort();
        return withClips.length > 0 ? monthOf(withClips[0]) : null;
    }, [countsByDate]);

    const days = useMemo(() => daysOfMonth(shownMonth, todayKey).map(dateKey => ({
        dateKey,
        count: countsByDate[dateKey] ?? 0,
        dayLabel: fmt(dateKey, { weekday: 'short' }, locale),
        dateLabel: fmt(dateKey, { day: 'numeric', month: 'short' }, locale),
    })), [shownMonth, todayKey, countsByDate, locale]);

    const prevMonth = firstMonth !== null && firstMonth < shownMonth ? shiftMonth(shownMonth, -1) : null;
    const nextMonth = shownMonth < monthOf(todayKey) ? shiftMonth(shownMonth, 1) : null;

    // A newly shown month opens with its chosen day in sight. The strip keeps its own sideways scroll,
    // so without this a month opened after he had scrolled to the 1st showed its old days and hid the
    // newest. Only on a month change: a day he taps inside the month is already on screen.
    const stripRef = useRef<HTMLDivElement>(null);
    const scrolledForMonth = useRef<string | null>(null);
    useLayoutEffect(() => {
        const strip = stripRef.current;
        if (!strip || scrolledForMonth.current === shownMonth) return;
        scrolledForMonth.current = shownMonth;
        const cell = strip.querySelector<HTMLElement>(`[data-testid="voice-diary-calendar-cell-${selectedDateKey}"]`);
        strip.scrollLeft = cell ? Math.max(0, cell.offsetLeft - (strip.clientWidth - cell.offsetWidth) / 2) : 0;
    }, [shownMonth, selectedDateKey]);

    // Opening a month lands on its newest day with a recording, else its newest day.
    const openMonth = (month: string) => {
        const monthDays = daysOfMonth(month, todayKey);
        const withClip = monthDays.find(k => (countsByDate[k] ?? 0) > 0);
        const target = withClip ?? monthDays[0];
        if (target) onSelectDate(target);
    };

    const monthButton = (month: string | null, dir: 'prev' | 'next') => (month === null
        ? <span className="min-w-[88px]" aria-hidden="true" />
        : (
            <button
                type="button"
                onClick={() => openMonth(month)}
                data-testid={`voice-diary-calendar-${dir}`}
                aria-label={fmt(`${month}-01`, { month: 'long', year: 'numeric' }, locale)}
                className={`flex min-h-[44px] min-w-[88px] items-center gap-1 rounded-full bg-white px-3 text-[14px] font-extrabold text-emerald-800 ring-1 ring-stone-200 active:scale-95 ${dir === 'next' ? 'justify-end' : ''}`}
            >
                {dir === 'prev' && <ChevronLeft size={18} aria-hidden="true" />}
                {fmt(`${month}-01`, { month: 'long' }, locale)}
                {dir === 'next' && <ChevronRight size={18} aria-hidden="true" />}
            </button>
        ));

    return (
        <div className="glass-panel p-4 rounded-3xl space-y-3" data-testid="voice-diary-calendar">
            <div className="flex items-center justify-between gap-2">
                {monthButton(prevMonth, 'prev')}
                <p className="m-0 text-center text-[16px] font-extrabold text-stone-900" data-testid="voice-diary-calendar-month">
                    {fmt(`${shownMonth}-01`, { month: 'long', year: 'numeric' }, locale)}
                </p>
                {monthButton(nextMonth, 'next')}
            </div>
            {/* `relative`: each day cell measures its offset from this strip (see the month scroll above) */}
            <div ref={stripRef} className="relative overflow-x-auto pb-1" data-testid="voice-diary-calendar-strip">
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
                                aria-pressed={selected}
                                className={`w-[76px] shrink-0 rounded-2xl border px-3 py-3 text-left transition-colors ${
                                    selected
                                        ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                                        : 'border-stone-200 bg-white text-stone-700'
                                }`}
                            >
                                <div className="text-[11px] font-bold text-stone-500">
                                    {day.dayLabel}
                                </div>
                                <div className="mt-1 text-sm font-bold tabular-nums">
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
                                        <span className="text-[9px] font-bold text-emerald-700">
                                            +{day.count - 3}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CalendarWithDots;
