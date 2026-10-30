/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — the three full-screen views of the chosen day on
 * आढावा, all in the person's language and all built from the same recording views (`RecordingCard.tsx`):
 *   - `DayFeedSheet`  — the day's work (the old "आजचा आढावा" feed), for the day the page is on: one row per
 *                       recording in time order; a row opens its glance;
 *   - `GlanceSheet`   — one recording, everything understood from it (the feed's and the notes' glance);
 *   - `PlotDaySheet`  — a plot card's day, in Marathi, replacing the English log drawer: the day part by part
 *                       (the result screen's `DayRow`s, each entry tied to who said it and when) and then EVERY
 *                       recording of that plot-day in time order, each with what / who / when / ▶. Numbers are never
 *                       summed across recordings (P4); an empty day says so and offers to add its work.
 */
import React, { useEffect } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { emitClosureSummaryViewed } from '../../../core/telemetry/eventEmitters';
import type { DailyLog } from '../../../types';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import { DayRow } from '../../logs/components/voiceResult/DayParts';
import { PARTS } from '../../logs/components/voiceResult/resultModel';
import { dayPartsOf, type DayRecording } from './dayRecordings';
import { RecordingCard, RecordingRow } from './RecordingCard';
import { useReflectCopy } from './RecordingParts';
import type { DayListen } from './useDayListen';

const SANS = "'Noto Sans Devanagari', sans-serif";
const NO_IDS: ReadonlySet<string> = new Set();

/** A test id from a log id (ids can carry characters a test id should not). */
export const recId = (rec: DayRecording): string => rec.view.id;

/** The frame of every full-screen view here: one big back, a head, a scrolling body. */
const Sheet: React.FC<{ testId: string; label: string; z: string; onBack: () => void; head?: React.ReactNode; children: React.ReactNode }> = ({ testId, label, z, onBack, head, children }) => {
    const copy = useReflectCopy();
    return (
        <div className={`fixed inset-0 ${z} flex justify-center bg-stone-900/30`}>
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId} style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onBack} data-testid={`${testId}-back`}
                        className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{copy.back}</span>
                    </button>
                    {head}
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">{children}</div>
            </div>
        </div>
    );
};

/** One recording, everything understood from it. */
export const GlanceSheet: React.FC<{ rec: DayRecording; listen: DayListen; onEdit?: (log: DailyLog) => void; onClose: () => void }> = ({ rec, listen, onEdit, onClose }) => {
    const copy = useReflectCopy();
    return (
        <Sheet testId="rf-glance" label={copy.understood} z="z-[60]" onBack={() => { listen.stop(); onClose(); }}>
            <RecordingCard rec={rec} listen={listen} big showPlace testId={`rf-glance-${recId(rec)}`} onEdit={onEdit} />
        </Sheet>
    );
};

/** The day's work, for the day the page is on. */
export const DayFeedSheet: React.FC<{
    recordings: readonly DayRecording[];
    isToday: boolean;
    dayLabel: string;
    listen: DayListen;
    onOpen: (rec: DayRecording) => void;
    onClose: () => void;
}> = ({ recordings, isToday, dayLabel, listen, onOpen, onClose }) => {
    const copy = useReflectCopy();
    return (
        <Sheet testId="rf-feed" label={copy.feedTitle(isToday)} z="z-[55]" onBack={() => { listen.stop(); onClose(); }}>
            <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="m-0 text-[20px] font-extrabold tracking-tight text-stone-900" data-testid="rf-feed-title">{copy.feedTitle(isToday)}</h3>
                <span className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[13px] font-bold text-stone-700 shadow-sm" data-testid="rf-feed-date">{dayLabel}</span>
            </div>
            {recordings.some(r => listen.kindOf(r) === 'clip') && <p className="m-0 px-1 text-[13px] font-semibold leading-snug text-stone-700" data-testid="rf-feed-hint">{copy.feedHint}</p>}
            {recordings.length === 0
                ? <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50 p-8 text-center text-[16px] font-semibold text-stone-600" data-testid="rf-feed-empty">{copy.feedEmpty(isToday)}</div>
                : <div className="space-y-2">{recordings.map(r => <RecordingRow key={r.key} rec={r} listen={listen} testId={`rf-feed-${recId(r)}`} onOpen={() => { listen.stop(); onOpen(r); }} />)}</div>}
        </Sheet>
    );
};

/** A plot card's day (replaces the English log drawer). */
export const PlotDaySheet: React.FC<{
    title: string;
    subtitle?: string;
    dayLabel: string;
    dateKey: string;
    recordings: readonly DayRecording[];
    listen: DayListen;
    onEdit?: (log: DailyLog) => void;
    onAdd?: () => void;
    onClose: () => void;
}> = ({ title, subtitle, dayLabel, dateKey, recordings, listen, onEdit, onAdd, onClose }) => {
    const copy = useReflectCopy();
    const { currentFarmId } = useFarmContext();
    const logsCount = recordings.reduce((n, r) => n + r.logs.length, 0);
    // DWC v2 §2.8 #7 — closure_summary.viewed when the day opens (the old drawer's event, kept).
    useEffect(() => {
        if (currentFarmId) emitClosureSummaryViewed({ farmId: currentFarmId, dateKey, logsCount, source: 'drawer_open' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const { byPart, byLog } = dayPartsOf(recordings);
    const head = (
        <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-extrabold leading-tight text-stone-900" data-testid="rf-day-title">{title}</span>
            <span className="block truncate text-[13px] font-bold text-stone-600" data-testid="rf-day-date">{[dayLabel, subtitle].filter(Boolean).join(' · ')}</span>
        </span>
    );
    return (
        <Sheet testId="rf-day" label={title} z="z-50" onBack={() => { listen.stop(); onClose(); }} head={head}>
            {recordings.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-white p-6 text-center" data-testid="rf-day-empty">
                    <p className="m-0 text-[16px] font-bold text-stone-700">{copy.dayEmpty}</p>
                    {onAdd && (
                        <button type="button" onClick={onAdd} data-testid="rf-day-add"
                            className="mx-auto mt-3 flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 text-[16px] font-extrabold text-white active:scale-95">
                            <Plus size={20} aria-hidden="true" /> {copy.addWork}
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <div data-testid="rf-day-parts">
                        <div className="flex items-baseline justify-between gap-2">
                            <h3 className="m-0 text-sm font-extrabold text-stone-700">{copy.dayWork}</h3>
                            <span className="text-[12px] font-bold text-stone-600" data-testid="rf-day-count">{copy.timesTold(recordings.length)}</span>
                        </div>
                        <p className="m-0 mb-2 text-[12px] text-stone-600">{copy.dayWorkHint}</p>
                        <div className="space-y-2">
                            {PARTS.filter(m => byPart[m.key].length > 0).map(m => (
                                <DayRow key={m.key} part={m.key} entries={byPart[m.key]} byLog={byLog} touched={false} showWho nowIds={NO_IDS} />
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2" data-testid="rf-day-recordings">
                        <h3 className="m-0 pt-1 text-sm font-extrabold text-stone-700">{copy.allRecordings}</h3>
                        {recordings.map(r => <RecordingCard key={r.key} rec={r} listen={listen} testId={`rf-day-rec-${recId(r)}`} onEdit={onEdit} />)}
                    </div>
                </>
            )}
        </Sheet>
    );
};
