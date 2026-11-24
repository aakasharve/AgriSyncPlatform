/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 8; approved spec "One viewer") - the three doors into the ONE day-card viewer:
 *   - `DayCardsDayButton`  the schedule page: the day of the followed schedule, read from the server version it follows (this phone's copy offline);
 *   - `OwnWorkCardButton`  planning: one work of the farmer's own schedule, drawn from the work the phone already holds (no signal needed);
 *   - `JobCardCardButton`  a job card made from an own work: finds that work on the phone and opens its card.
 * Each opens the viewer over the page it was opened from; the viewer's back (or the phone's Back) returns to it. A door that has nothing to open stays out of sight
 * rather than leading to an empty page.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { LayoutList } from 'lucide-react';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { shownScheduleDay } from '../schedulePage/scheduleDates';
import { DayCardsViewer } from './DayCardsViewer';
import { loadDayCards, type DayCardsLoad } from './dayCardsStore';
import { detailFromOwnTask } from './dayCardsTypes';
import { dayCardWords } from './dayCardWords';
import type { TakeHost } from '../ownSchedule/TakeIntoMyScheduleButton';

const useWords = () => dayCardWords(useOptionalLanguage()?.language === 'en' ? 'en' : 'mr');

const OpenButton: React.FC<{ label: string; onClick: () => void; testId: string }> = ({ label, onClick, testId }) => (
    <button type="button" onClick={onClick} data-testid={testId}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-700 bg-white px-4 text-[16px] font-extrabold text-emerald-900">
        <LayoutList size={20} aria-hidden="true" />{label}
    </button>
);

/** The schedule page's door: the followed schedule's cards of `storedDay` (the one helper turns it into the shown day). Hidden until the version is known to open. */
export const DayCardsDayButton: React.FC<{ templateId: string; storedDay: number; load?: (id: string) => Promise<DayCardsLoad>; /** Slice 9: the plot-season this followed schedule is for; the viewer then offers the take on a checked reference. */ take?: TakeHost }> = ({ templateId, storedDay, load = loadDayCards, take }) => {
    const words = useWords();
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let alive = true;
        // Reading it once also keeps this phone's copy, so the cards open later with no signal.
        void load(templateId).then(r => { if (alive) setReady(r.ok); }).catch(() => { if (alive) setReady(false); });
        return () => { alive = false; };
    }, [templateId, load]);
    if (!ready) return null;
    return (
        <>
            <OpenButton label={words.openDay} onClick={() => setOpen(true)} testId="open-day-cards" />
            {open && <DayCardsViewer source={{ templateId }} target={{ day: Math.max(1, shownScheduleDay(storedDay)) }} onClose={() => setOpen(false)} load={load} take={take ? { ...take, todayStored: take.todayStored ?? storedDay } : undefined} />}
        </>
    );
};

/** Planning's door: one own work, drawn from the work itself (it is on the phone: no signal needed, P10). */
export const OwnWorkCardButton: React.FC<{ task: ScheduleTaskContent; scheduleId: string; contentHash?: string }> = ({ task, scheduleId, contentHash = '' }) => {
    const words = useWords();
    const [open, setOpen] = useState(false);
    const detail = useMemo(() => detailFromOwnTask(task, scheduleId, contentHash), [task, scheduleId, contentHash]);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} data-testid={`own-list-card-${task.taskKey}`} className="min-h-[48px] rounded-full px-3 text-[15px] font-extrabold text-emerald-800">{words.openWork}</button>
            {open && <DayCardsViewer source={{ detail }} target={{ taskKey: task.taskKey }} onClose={() => setOpen(false)} />}
        </>
    );
};

/** A job card's door: the own work the plan was made from, found on this phone. Nothing is drawn while that work is not on the phone. */
export const JobCardCardButton: React.FC<{ ownItemId: string | null | undefined }> = ({ ownItemId }) => {
    const words = useWords();
    const [found, setFound] = useState<{ task: ScheduleTaskContent; hash: string } | null>(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        let alive = true;
        if (!ownItemId) return undefined;
        getDatabase().ownScheduleItems.get(ownItemId)
            .then(row => { if (alive) setFound(row ? { task: row.task, hash: row.contentHash } : null); })
            .catch(() => { if (alive) setFound(null); });
        return () => { alive = false; };
    }, [ownItemId]);
    const detail = useMemo(() => (found && ownItemId ? detailFromOwnTask(found.task, ownItemId, found.hash) : null), [found, ownItemId]);
    if (!detail || !found) return null;
    return (
        <>
            <OpenButton label={words.openWork} onClick={() => setOpen(true)} testId="job-card-open-card" />
            {open && <DayCardsViewer source={{ detail }} target={{ taskKey: found.task.taskKey }} onClose={() => setOpen(false)} />}
        </>
    );
};
