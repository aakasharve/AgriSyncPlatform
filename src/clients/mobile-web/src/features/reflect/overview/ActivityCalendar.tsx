/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * कामाचं कॅलेंडर — the old Activity Calendar, kept whole and put in plain words (facts: `calendarModel.ts`).
 *   - आठवडा: seven rows, one per day — each record a chip in its CROP's colour with the plot (and its
 *     number) and the main work; whole-farm work a grey chip; a stopped day an amber "काम थांबलं"; rain a
 *     blue wash and a cloud; an empty day says "नोंद नाही".
 *   - महिना: the month grid — under each date one coloured strip per crop that had work, amber = stopped,
 *     grey = whole farm, a cloud for rain.
 *   - ‹ › move a week or a month; tapping a day shows that day in the plot cards and notes above.
 * Added (approved preview): an open to-do sits on its due day (a dashed 🔔 chip), and the colour key names
 * every crop. Every Marathi string is PROPOSED.
 */
import React from 'react';
import { Bell, ChevronLeft, ChevronRight, CloudRain, Grid3X3, LayoutList } from 'lucide-react';
import type { CalendarDay } from './calendarModel';
import { WEEKDAY_SHORT_LIST, addDays, dateLabel, monthGridOf, monthLabel, sameDay, weekOf, weekdayShortOf } from './reflectDates';
import { Num, Tap } from './ui';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { cropNameIn } from '../../../shared/names/namesIn';

export type CalendarMode = 'week' | 'month';

interface Props {
    date: Date;
    onDate: (d: Date) => void;
    mode: CalendarMode;
    onMode: (m: CalendarMode) => void;
    view: Date;
    onView: (d: Date) => void;
    dayOf: (d: Date) => CalendarDay;
    legendCrops: readonly { id: string; name: string; color: string }[];
}

export const ActivityCalendar: React.FC<Props> = ({ date, onDate, mode, onMode, view, onView, dayOf, legendCrops }) => {
    const language = useOptionalLanguage()?.language ?? 'mr'; // spec I18 — crop names in his language
    const move = (n: number) => onView(mode === 'week' ? addDays(view, 7 * n) : new Date(view.getFullYear(), view.getMonth() + n, 1, 12));
    const week = weekOf(view);
    // "19–25 ऑक्टो" in one line; the month is named twice only when the week crosses into the next one
    const title = mode === 'month' ? monthLabel(view)
        : week[0].getMonth() === week[6].getMonth() ? `${week[0].getDate()}–${dateLabel(week[6])}` : `${dateLabel(week[0])} – ${dateLabel(week[6])}`;

    return (
        <div data-testid="activity-calendar">
            {/* two rows: on a phone the switch and the arrows do not fit side by side */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
                {([['week', 'आठवडा', <LayoutList key="w" size={16} aria-hidden="true" />], ['month', 'महिना', <Grid3X3 key="m" size={16} aria-hidden="true" />]] as const).map(([k, l, icon]) => (
                    <Tap key={k} onClick={() => onMode(k)} aria-pressed={mode === k} data-testid={`cal-mode-${k}`}
                        className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg text-[15px] font-extrabold ${mode === k ? 'bg-white text-emerald-800 shadow' : 'text-stone-500'}`}>{icon}{l}</Tap>
                ))}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-xl bg-white ring-1 ring-stone-200">
                <Tap onClick={() => move(-1)} aria-label={mode === 'week' ? 'मागचा आठवडा' : 'मागचा महिना'} data-testid="cal-prev" className="grid h-11 w-11 place-items-center rounded-full text-stone-600"><ChevronLeft size={22} aria-hidden="true" /></Tap>
                <span className="text-center text-[15.5px] font-extrabold text-stone-800" data-testid="cal-title">{title}</span>
                <Tap onClick={() => move(1)} aria-label={mode === 'week' ? 'पुढचा आठवडा' : 'पुढचा महिना'} data-testid="cal-next" className="grid h-11 w-11 place-items-center rounded-full text-stone-600"><ChevronRight size={22} aria-hidden="true" /></Tap>
            </div>

            {mode === 'week' ? (
                <div className="mt-3 space-y-2">
                    {week.map(d => {
                        const m = dayOf(d);
                        const sel = sameDay(d, date);
                        return (
                            <Tap key={m.key} onClick={() => onDate(d)} data-testid={`cal-day-${m.key}`} aria-pressed={sel}
                                className={`relative flex w-full items-stretch overflow-hidden rounded-xl border text-left ${sel ? 'border-emerald-500 ring-1 ring-emerald-500' : m.blocked ? 'border-amber-200' : 'border-stone-200'} ${m.blocked ? 'bg-amber-50/60' : 'bg-white'}`}>
                                {m.rainy && !m.blocked && <span className="pointer-events-none absolute inset-0 bg-blue-50/50" aria-hidden="true" />}
                                <span className={`relative flex w-16 shrink-0 flex-col items-center justify-center border-r py-2 ${sel ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-stone-100 bg-stone-50 text-stone-600'}`}>
                                    <span className="text-[12px] font-extrabold">{m.isToday ? 'आज' : weekdayShortOf(d)}</span>
                                    <Num className="text-[22px] font-extrabold leading-none">{d.getDate()}</Num>
                                </span>
                                <span className="relative flex flex-1 flex-wrap items-center gap-1.5 p-2">
                                    {m.blocked ? (
                                        <span className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-[13px] font-extrabold text-amber-800" data-testid={`cal-stopped-${m.key}`}>
                                            काम थांबलं — {m.blocked.groupLabel}{m.blocked.reason ? `: ${m.blocked.reason}` : ''}
                                        </span>
                                    ) : (
                                        <>
                                            {m.farmWide && <span className="rounded-lg bg-stone-500 px-2 py-1 text-[13px] font-extrabold text-white">पूर्ण शेत</span>}
                                            {m.chips.map(x => (
                                                <span key={x.logId} className={`rounded-lg px-2 py-1 text-white shadow-sm ${x.color}`} data-testid={`cal-chip-${x.logId}`}>
                                                    <span className="flex items-center gap-1 text-[11px] font-bold leading-none opacity-90">
                                                        {x.plotIndex !== undefined && <Num className="rounded bg-white/25 px-1">{x.plotIndex + 1}</Num>}{x.plotLabel}
                                                    </span>
                                                    <span className="block text-[13px] font-extrabold leading-tight">{x.activity}</span>
                                                </span>
                                            ))}
                                        </>
                                    )}
                                    {m.due.map(t => (
                                        <span key={t.id} className="inline-flex items-center gap-1 rounded-lg border-2 border-dashed border-sky-400 bg-white px-2 py-1 text-[12.5px] font-extrabold text-sky-800" data-testid={`cal-due-${t.id}`}>
                                            <Bell size={13} aria-hidden="true" />{t.title}
                                        </span>
                                    ))}
                                    {m.empty && <span className="pl-1 text-[13px] font-semibold italic text-stone-400">नोंद नाही</span>}
                                    {m.rainy && <CloudRain size={15} className="absolute right-1.5 top-1.5 text-blue-400" aria-label="पाऊस" />}
                                </span>
                            </Tap>
                        );
                    })}
                </div>
            ) : (
                <div className="mt-3">
                    <div className="mb-1 grid grid-cols-7">{WEEKDAY_SHORT_LIST.map(w => <span key={w} className="text-center text-[11.5px] font-extrabold text-stone-500">{w}</span>)}</div>
                    <div className="grid grid-cols-7 gap-1">
                        {monthGridOf(view).map((d, i) => {
                            if (!d) return <span key={`e${i}`} className="min-h-[62px]" />;
                            const m = dayOf(d);
                            const sel = sameDay(d, date);
                            return (
                                <Tap key={m.key} onClick={() => onDate(d)} data-testid={`cal-cell-${m.key}`} aria-pressed={sel}
                                    className={`relative flex min-h-[62px] flex-col justify-between rounded-lg border p-1 text-left ${sel ? 'border-emerald-500 ring-2 ring-emerald-500' : 'border-stone-100'} ${m.blocked ? 'bg-amber-50' : m.rainy ? 'bg-blue-50/60' : 'bg-white'}`}>
                                    <Num className={`text-[12px] font-extrabold ${m.isToday ? 'text-emerald-700' : m.offset > 0 ? 'text-stone-300' : 'text-stone-700'}`}>{d.getDate()}</Num>
                                    {m.rainy && <CloudRain size={11} className="absolute right-1 top-1 text-blue-400" aria-hidden="true" />}
                                    <span className="flex w-full flex-col gap-0.5">
                                        {m.blocked && <span className="h-1.5 w-full rounded-full bg-amber-400" />}
                                        {!m.blocked && m.farmWide && <span className="h-1.5 w-full rounded-full bg-stone-400" />}
                                        {!m.blocked && m.cropColors.slice(0, 4).map(c => <span key={c} className={`h-1.5 w-full rounded-full ${c}`} />)}
                                        {!m.blocked && m.cropColors.length > 4 && <span className="h-1.5 w-full rounded-full bg-stone-200" />}
                                        {m.due.length > 0 && <span className="h-1.5 w-full rounded-full border border-dashed border-sky-500" />}
                                    </span>
                                </Tap>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-stone-100 pt-2.5 text-[12px] font-extrabold text-stone-600" data-testid="cal-key">
                {legendCrops.map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${c.color}`} />{cropNameIn(c.name, language)}</span>
                ))}
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-stone-400" />पूर्ण शेत</span>
                <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />काम थांबलं</span>
                <span className="inline-flex items-center gap-1"><CloudRain size={12} className="text-blue-400" aria-hidden="true" />पाऊस</span>
                <span className="inline-flex items-center gap-1"><Bell size={12} className="text-sky-600" aria-hidden="true" />आठवण / काम</span>
            </div>
        </div>
    );
};
