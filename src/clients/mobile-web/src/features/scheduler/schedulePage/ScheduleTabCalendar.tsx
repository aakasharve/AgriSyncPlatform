/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, items 4 and 5; version 7) - the in-tab calendar, built ONLY from what the phone holds (the plot's schedule
 * model: its days, their verdicts, the stage each belongs to). Each date carries its small schedule day (the ONE helper `shownScheduleDay`; a day before the start reads
 * "-N", never day 0), and a tap opens the ONE day-card viewer on that day. "आजची कार्डं" is the existing door (`DayCardsDayButton`); "पूर्ण हंगाम पाहा" opens the same
 * viewer on the first day, where its stepper reaches every day of the season. No second renderer. Nothing here needs the network.
 */
import React, { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Map as MapIcon, X } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { DayCardsDayButton } from '../dayCards/DayCardsEntries';
import { DayCardsViewer } from '../dayCards/DayCardsViewer';
import type { TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';
import { mrNum } from './scheduleCopy';
import { addDays, shownScheduleDay } from './scheduleDates';
import { dayVerdict, type ScheduleDay, type ScheduleModel } from './scheduleModel';

export const CALENDAR_WORDS = {
    mr: {
        title: 'कॅलेंडर', legendDone: 'पाळलं', legendPart: 'काही वेगळं', legendMissed: 'राहिलं, कारण बाकी', legendToday: 'आजचा दिवस', cards: 'आजची कार्डं', prev: 'मागचा महिना', next: 'पुढचा महिना', week: ['रवि', 'सोम', 'मंगळ', 'बुध', 'गुरु', 'शुक्र', 'शनि'], ruleLine: 'तारखेखालचा लहान आकडा = शेड्यूलचा दिवस (दिवस १ = सुरुवातीचा दिवस); सुरुवातीआधीचे दिवस − चिन्हासह',
        fullSeason: 'पूर्ण हंगाम पाहा', tapRule: 'तारीख दाबा: त्या दिवसाची कार्डं', done: 'पाळलं', missed: 'राहिलं', today: 'आज',
    },
    en: {
        title: 'Calendar', legendDone: 'Done', legendPart: 'Partly different', legendMissed: 'Left, reason pending', legendToday: 'Today', cards: "Today's cards", prev: 'Previous month', next: 'Next month', week: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ruleLine: 'The small number under a date = the schedule day (day 1 = the start day); days before the start carry a minus',
        fullSeason: 'See the whole season', tapRule: 'Tap a date: that day\'s cards', done: 'Done', missed: 'Left', today: 'Today',
    },
} as const;

/** One colour per stage, in stage order (the stage's colour on its dates, in the legend and nowhere else). */
export const STAGE_COLOURS = ['#7C8B99', '#0F766E', '#2563EB', '#7C3AED', '#C2410C', '#92400E', '#0E7490', '#65A30D', '#BE185D', '#A16207'] as const;
export type DayMark = 'done' | 'part' | 'missed' | null;
/** A mark only where the phone holds evidence: a day with work the schedule expected, judged from the plot's own logs. A day not yet over is never marked missed (P4). */
export function dayMark(day: ScheduleDay, todayKey: string): DayMark {
    if (day.prep || day.key > todayKey) return null;
    const v = dayVerdict(day);
    if (v === 'allDone') return 'done';
    if (day.key === todayKey) return v === 'mixed' ? 'part' : null;
    return v === 'mixed' ? 'part' : v === 'missed' ? 'missed' : null;
}
const monthOf = (key: string) => key.slice(0, 7);
const firstOf = (month: string) => `${month}-01`;
const monthStep = (month: string, n: number): string => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export const ScheduleTabCalendar: React.FC<{ templateId: string; model: ScheduleModel; take?: TakeHost; scheduleName?: string }> = ({ templateId, model, take, scheduleName }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = CALENDAR_WORDS[language];
    const num = (n: number | string) => (language === 'mr' ? mrNum(n) : String(n));
    const [month, setMonth] = useState(monthOf(model.todayKey));
    const [openDay, setOpenDay] = useState<number | null>(null);
    const [season, setSeason] = useState(false);
    const monthLabel = useMemo(() => {
        try { return new Intl.DateTimeFormat(language === 'mr' ? 'mr-IN-u-nu-deva' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${firstOf(month)}T00:00:00Z`)); } catch { return month; }
    }, [month, language]);
    const cells = useMemo(() => {
        const lead = weekdayOf(firstOf(month));
        const out: Array<{ key: string; n: number } | null> = Array.from({ length: lead }, () => null);
        for (let d = 1; d <= daysIn(month); d += 1) out.push({ key: addDays(firstOf(month), d - 1), n: d });
        return out;
    }, [month]);
    const todayDay = model.byKey.get(model.todayKey);
    const todayStored = todayDay?.day ?? model.todayDay;

    return (
        <section className="space-y-2 rounded-3xl border border-stone-200 bg-white p-3 shadow-sm" data-testid="schedule-calendar">
            <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-[19px] font-black text-emerald-900" data-testid="calendar-title">{words.title}{scheduleName ? ` · ${scheduleName}` : ''}</h3>
                {todayDay && !model.ended && <DayCardsDayButton templateId={templateId} storedDay={todayDay.day} take={take} />}
            </div>
            <div className="flex items-center justify-between">
                <button type="button" aria-label={words.prev} onClick={() => setMonth(m => monthStep(m, -1))} data-testid="calendar-prev" className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full border border-stone-300"><ChevronLeft size={20} aria-hidden="true" /></button>
                <p className="m-0 text-[18px] font-black text-stone-900" data-testid="calendar-month">{monthLabel}</p>
                <button type="button" aria-label={words.next} onClick={() => setMonth(m => monthStep(m, 1))} data-testid="calendar-next" className="grid min-h-[48px] min-w-[48px] place-items-center rounded-full border border-stone-300"><ChevronRight size={20} aria-hidden="true" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" data-testid="calendar-grid">
                {words.week.map(w => <span key={w} className="text-[12px] font-extrabold text-stone-500">{w}</span>)}
                {cells.map((c, i) => {
                    if (!c) return <span key={`b${i}`} />;
                    const day = model.byKey.get(c.key);
                    const verdict = day ? dayVerdict(day) : 'none';
                    const isToday = c.key === model.todayKey;
                    const small = day ? (day.day < 0 ? `−${num(-day.day)}` : num(shownScheduleDay(day.day))) : '';
                    const colour = STAGE_COLOURS[(model.stages.find(st => st.id === day?.stageId)?.index ?? 0) % STAGE_COLOURS.length];
                    const mark = day ? dayMark(day, model.todayKey) : null;
                    return day ? (
                        <button key={c.key} type="button" onClick={() => setOpenDay(shownScheduleDay(day.day))} data-testid={`calendar-day-${c.key}`} data-verdict={verdict} data-mark={mark ?? ''} data-today={isToday ? 'yes' : 'no'}
                            style={{ background: `${colour}22`, borderColor: isToday ? '#1448E6' : `${colour}66` }}
                            className={`relative flex min-h-[48px] flex-col items-center justify-center rounded-xl border-2 px-0 leading-none text-stone-900 ${isToday ? 'ring-2 ring-[#1448E6]' : ''}`}>
                            {mark && <span className={`absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full text-[10px] font-black text-white ${mark === 'done' ? 'bg-emerald-600' : mark === 'part' ? 'bg-amber-500' : 'bg-rose-600'}`} data-testid={`calendar-mark-${c.key}`} aria-label={mark === 'done' ? words.legendDone : mark === 'part' ? words.legendPart : words.legendMissed}>
                                {mark === 'done' ? <Check size={10} aria-hidden="true" /> : mark === 'part' ? '!' : <X size={10} aria-hidden="true" />}</span>}
                            <span className="text-[15px] font-black">{num(c.n)}</span><span className="text-[11px] font-bold opacity-80" data-testid={`calendar-shown-${c.key}`}>{small}</span>
                        </button>
                    ) : (
                        <span key={c.key} className="flex min-h-[48px] flex-col items-center justify-center rounded-xl border border-stone-100 text-[15px] font-bold text-stone-400">{num(c.n)}</span>
                    );
                })}
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-[12.5px] font-bold text-stone-700" data-testid="calendar-legend">
                {model.stages.map(st => <li key={st.id} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: STAGE_COLOURS[st.index % STAGE_COLOURS.length] }} aria-hidden="true" />{st.name}</li>)}
                <li className="flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-600 text-white"><Check size={10} aria-hidden="true" /></span>{words.legendDone}</li>
                <li className="flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-amber-500 text-[10px] font-black text-white">!</span>{words.legendPart}</li>
                <li className="flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded-full bg-rose-600 text-white"><X size={10} aria-hidden="true" /></span>{words.legendMissed}</li>
                <li className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm ring-2 ring-[#1448E6]" aria-hidden="true" />{words.legendToday}</li>
            </ul>
            <p className="m-0 text-[13px] font-bold text-stone-600" data-testid="calendar-rule">{words.ruleLine}. {words.tapRule}</p>
            <button type="button" onClick={() => setSeason(true)} data-testid="calendar-full-season" className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-700 bg-white px-4 text-[16px] font-extrabold text-emerald-900">
                <MapIcon size={20} aria-hidden="true" />{words.fullSeason}
            </button>
            {openDay !== null && <DayCardsViewer source={{ templateId }} target={{ day: openDay }} onClose={() => setOpenDay(null)} take={take ? { ...take, todayStored: take.todayStored ?? todayStored } : undefined} />}
            {season && <DayCardsViewer source={{ templateId }} target={{ day: 1 }} onClose={() => setSeason(false)} take={take ? { ...take, todayStored: take.todayStored ?? todayStored } : undefined} />}
        </section>
    );
};
