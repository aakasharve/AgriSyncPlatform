/**
 * The day-by-day grid of a plot's schedule (दिवसवार तक्ता): one row per day, four cells — सिंचन, खत, फवारणी,
 * कामे — from 7 days back to the schedule's last day, grouped by stage, with "तुम्ही इथे आहात" on today.
 * In a plot's first 10 days it starts at the land-preparation days before day 0 instead ("तयारी", the old
 * grid's PREP rows), as the old grid did. A row's weather shows its numbers only: the provider's condition
 * text is English, so it is not shown on this Marathi grid.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2, S6, S16). It used to:
 *   - guess the crop from the template id's TEXT (`templateId.includes('grape')`…), which never matches the
 *     server's GUID ids, so every real plot got a generic stand-in schedule — it now draws the page's model,
 *     built from the plot's real template (resolved from the real crop);
 *   - read only the FIRST log of a day — every log of the day now counts;
 *   - never say MISSED — a past day whose expected part was not done now says राहिलं;
 *   - speak English (Water / Nutri / Spray / Work, DAY, "We are here") — now Marathi.
 * Tapping any cell opens that day's sheet (it opened an English per-cell popup that made up advice).
 */
import React, { useEffect, useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import DayCard, { type BlockStatus, type DayCardProps, type DayCardWords } from './DayCard';
import { addDays, dayDateLabel } from '../schedulePage/scheduleDates';
import { SC } from '../schedulePage/scheduleCopy';
import { PART_LABEL, type CellStatus, type DayCell, type ScheduleDay, type ScheduleModel } from '../schedulePage/scheduleModel';

interface SchedulerTimelineProps {
    model: ScheduleModel;
    onOpenDay: (dateKey: string) => void;
}

const BLOCK: Readonly<Record<CellStatus, BlockStatus>> = {
    done: 'DONE', extra: 'DONE', missed: 'MISSED', due: 'PENDING', planned: 'PLANNED', none: 'NOT_REQUIRED',
};

export const GRID_WORDS: DayCardWords = {
    day: 'दिवस',
    prep: SC.prep,
    status: { DONE: SC.doneWord, MISSED: SC.missedWord, PENDING: SC.expectedWord, PLANNED: SC.expectedWord, NOT_REQUIRED: '—' },
};

/** The old grid started 15 days before day 0 while the plot was within its first 10 days. */
const PREP_VIEW_UNTIL_DAY = 10;

// The schedule's own task name when it has one, so two different sprays on a day read differently.
const note = (cell: DayCell): string | undefined =>
    cell.items.length > 0 ? cell.items.map(i => i.detail ?? i.title).join(', ') : cell.status === 'extra' ? SC.extraWord : undefined;

function weatherOf(day: ScheduleDay): DayCardProps['weatherContext'] {
    const log = day.logs.find(l => l.weatherStamp || l.weatherSnapshot?.current);
    if (!log) return undefined;
    if (log.weatherStamp) {
        const ws = log.weatherStamp;
        return { tempC: ws.tempC, conditionText: ws.conditionText, iconCode: ws.iconCode, humidity: ws.humidity, windKph: ws.windKph, cloudCover: ws.cloudCoverPct, isSevere: ws.precipMm > 15 || ws.windKph > 40 };
    }
    const ws = log.weatherSnapshot!.current;
    return { tempC: ws.tempC, conditionText: ws.conditionText, iconCode: ws.iconCode, humidity: ws.humidity, windKph: ws.windKph, cloudCover: 0, isSevere: ws.precipMm > 15 || ws.windKph > 40 };
}

const SchedulerTimeline: React.FC<SchedulerTimelineProps> = ({ model, onOpenDay }) => {
    const groups = useMemo(() => {
        const from = model.todayDay <= PREP_VIEW_UNTIL_DAY ? (model.days[0]?.key ?? model.todayKey) : addDays(model.todayKey, -7);
        const out: { stageId: string | null; prep: boolean; name: string; days: ScheduleDay[] }[] = [];
        for (const day of model.days) {
            if (day.key < from) continue;
            const last = out[out.length - 1];
            if (last && last.stageId === day.stageId && last.prep === day.prep) last.days.push(day);
            else out.push({ stageId: day.stageId, prep: day.prep, name: day.prep ? SC.prep : model.stages.find(s => s.id === day.stageId)?.name ?? '—', days: [day] });
        }
        return out;
    }, [model]);

    useEffect(() => {
        const t = setTimeout(() => document.getElementById('scheduler-today-row')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
        return () => clearTimeout(t);
    }, [model.todayKey]);

    return (
        <div className="space-y-6 pb-24" data-testid="schedule-grid">
            {groups.map(group => (
                <div key={`${group.stageId}-${group.days[0].key}`} className="relative">
                    <div className="sticky top-[61px] z-10 flex items-center justify-between gap-2 border-b-2 border-stone-800 bg-[#FDFBF7] px-2 py-2">
                        <h3 className="m-0 text-[16px] font-black text-stone-800">{group.name}</h3>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[13px] font-bold text-stone-600">
                            {SC.dayN(group.days[0].day)} – {group.days[group.days.length - 1].day}
                        </span>
                    </div>
                    <div className="flex border-b border-stone-300 bg-stone-50 py-1.5 text-[12px] font-extrabold text-stone-600">
                        <div className="w-14 border-r border-stone-200 text-center">{GRID_WORDS.day}</div>
                        <div className="grid flex-1 grid-cols-4 divide-x divide-stone-200 text-center">
                            <div className="text-blue-700">{PART_LABEL.irrigation}</div>
                            <div className="text-emerald-700">{PART_LABEL.nutrition}</div>
                            <div className="text-rose-700">{PART_LABEL.spray}</div>
                            <div className="text-amber-700">{PART_LABEL.work}</div>
                        </div>
                    </div>
                    <div className="ml-0.5 border-l-4 border-l-stone-800">
                        {group.days.map(day => (
                            <div key={day.key} id={day.when === 'today' ? 'scheduler-today-row' : undefined} className="relative" data-testid={`grid-${day.key}`}>
                                {day.when === 'today' && (
                                    <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-full border border-emerald-100 bg-white/90 px-2 py-1 shadow-md">
                                        <span className="text-[12px] font-black text-emerald-700">{SC.here}</span>
                                        <ArrowLeft size={16} strokeWidth={3} className="text-emerald-500" aria-hidden="true" />
                                    </div>
                                )}
                                <DayCard
                                    dayNumber={day.day}
                                    dateLabel={dayDateLabel(day.key)}
                                    isToday={day.when === 'today'}
                                    isPast={day.when === 'past'}
                                    dayType={day.prep ? 'PREP' : 'CYCLE'}
                                    status={{ irrigation: BLOCK[day.cells.irrigation.status], nutrition: BLOCK[day.cells.nutrition.status], spray: BLOCK[day.cells.spray.status], activity: BLOCK[day.cells.work.status] }}
                                    notes={{ irrigation: note(day.cells.irrigation), nutrition: note(day.cells.nutrition), spray: note(day.cells.spray), activity: note(day.cells.work) }}
                                    onTapBlock={() => onOpenDay(day.key)}
                                    weatherContext={weatherOf(day)}
                                    words={GRID_WORDS}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default SchedulerTimeline;
