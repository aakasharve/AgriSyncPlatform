/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, round 3; version 7 item 9) - the two tabs under the cards: "कॅलेंडर" | "आज: सगळी शेड्यूल". The second lists today's works of
 * every schedule the plot follows, the same work in two schedules as ONE card with a source pick (`SameWorkSection`). Opens on the calendar.
 */
import React, { useState } from 'react';
import { CalendarDays, ListChecks } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';
import { SameWorkSection } from './SameWorkSection';
import { ScheduleTabCalendar } from './ScheduleTabCalendar';
import type { ScheduleModel } from './scheduleModel';

export const PANE_WORDS = { mr: { calendar: 'कॅलेंडर', today: 'आज: सगळी शेड्यूल' }, en: { calendar: 'Calendar', today: 'Today: all schedules' } } as const;

export const ScheduleCalendarTabs: React.FC<{ templateId: string; versionIds: readonly string[]; model: ScheduleModel; take?: TakeHost; scheduleName?: string }> = ({ templateId, versionIds, model, take, scheduleName }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = PANE_WORDS[language];
    const [pane, setPane] = useState<'calendar' | 'today'>('calendar');
    const tab = (id: 'calendar' | 'today', label: string, icon: React.ReactNode) => (
        <button type="button" role="tab" aria-selected={pane === id} onClick={() => setPane(id)} data-testid={`pane-tab-${id}`}
            className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl px-2 text-[16px] font-extrabold ${pane === id ? 'bg-white text-stone-900 shadow' : 'text-stone-600'}`}>{icon}{label}</button>
    );
    return (
        <div className="space-y-2" data-testid="schedule-panes">
            <div role="tablist" className="flex gap-1 rounded-2xl bg-stone-100 p-1">
                {tab('calendar', words.calendar, <CalendarDays size={18} aria-hidden="true" />)}
                {tab('today', words.today, <ListChecks size={18} aria-hidden="true" />)}
            </div>
            {pane === 'calendar'
                ? <ScheduleTabCalendar templateId={templateId} model={model} take={take} scheduleName={scheduleName} />
                : <SameWorkSection versionIds={versionIds} take={take ? { ...take, todayStored: take.todayStored ?? model.todayDay } : undefined} todayStored={model.todayDay} />}
        </div>
    );
};
