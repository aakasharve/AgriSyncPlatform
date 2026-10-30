/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF, RF2 and its fix pass) — the two full-screen views of the
 * chosen day on आढावा, built from the same recording views and the same time chips (`RecordingTimes.tsx`):
 *
 *   - `PlotDayView` (the founder's screen 1, tap a plot card): ALL of that plot-day's work sorted into the result
 *     screen's buckets (`DayRow`, opened, each value with the time it was told), then the time chips; "आणखी सांगा"
 *     (today) asks THE ONE mic and lands back here with the new work highlighted;
 *   - `DayFeedSheet` (the founder's screen 2, behind the "आजचा आढावा" button — the founder 2026-10-30: "put it as it is,
 *     I asked you to rebuild the screen inside it"): ONE block per plot that had work that day, plus a "संपूर्ण शेत"
 *     block for work with no plot; each block its identity, "N वेळा सांगितलं" and ONE row of time chips, a tap opening
 *     that recording right there in the block.
 * No source-words panel and no quoted words on either (fix pass D4). Nothing summed across recordings (P4).
 */
import React, { useEffect, useMemo } from 'react';
import { ArrowLeft, Map as MapIcon, Mic } from 'lucide-react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { emitClosureSummaryViewed } from '../../../core/telemetry/eventEmitters';
import type { DailyLog } from '../../../types';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import { BlockerRow, DayRow } from '../../logs/components/voiceResult/DayParts';
import { withoutQuotes } from '../../logs/components/voiceResult/partNames';
import { PARTS, type PartKey } from '../../logs/components/voiceResult/resultModel';
import { CropPhoto } from '../overview/ui';
import { dayPartsOf, type DayRecording } from './dayRecordings';
import { RecordingTimes, recId } from './RecordingTimes';
import { useReflectCopy } from './RecordingParts';
import type { DayListen } from './useDayListen';

export { recId };

const SANS = "'Noto Sans Devanagari', sans-serif";
const NO_IDS: ReadonlySet<string> = new Set();

/** The frame of a full-screen view here: one big back, a head, a scrolling body. */
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

/** A plot card's day (and the whole farm's, and a note's recording). */
export const PlotDayView: React.FC<{
    title: string;
    subtitle?: string;
    dayLabel: string;
    dateKey: string;
    isToday: boolean;
    recordings: readonly DayRecording[];
    listen: DayListen;
    /** Open on this recording (a note's link). */
    openKey?: string | null;
    /** Logs just told through the ONE mic from here: their parts and time chip are highlighted. */
    fresh?: ReadonlySet<string>;
    onEdit?: (log: DailyLog) => void;
    /** "आणखी सांगा" — today only (a recording is always today's, so another day offers no such button, P5). */
    onTellMore?: () => void;
    onClose: () => void;
}> = ({ title, subtitle, dayLabel, dateKey, isToday, recordings, listen, openKey = null, fresh = NO_IDS, onEdit, onTellMore, onClose }) => {
    const copy = useReflectCopy();
    const { currentFarmId } = useFarmContext();
    const logsCount = recordings.reduce((n, r) => n + r.logs.length, 0);
    // DWC v2 §2.8 #7 — closure_summary.viewed when the day opens (the old drawer's event, kept).
    useEffect(() => {
        if (currentFarmId) emitClosureSummaryViewed({ farmId: currentFarmId, dateKey, logsCount, source: 'drawer_open' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const { byPart, byLog } = dayPartsOf(recordings);
    const freshParts = useMemo(() => new Set<PartKey>(PARTS.map(p => p.key).filter(k => byPart[k].some(e => fresh.has(e.logId)))), [byPart, fresh]);
    const blockers = withoutQuotes(recordings.flatMap(r => r.view.blockers));
    const head = (
        <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-extrabold leading-tight text-stone-900" data-testid="rf-day-title">{title}</span>
            <span className="block truncate text-[13px] font-bold text-stone-600" data-testid="rf-day-date">{[dayLabel, subtitle].filter(Boolean).join(' · ')}</span>
        </span>
    );
    const tellMore = onTellMore && (
        <button type="button" onClick={() => { listen.stop(); onTellMore(); }} data-testid="rf-day-tell"
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 text-[17px] font-extrabold text-white active:scale-95">
            <Mic size={22} aria-hidden="true" /> {copy.tellMore}
        </button>
    );
    return (
        <Sheet testId="rf-day" label={title} z="z-50" onBack={() => { listen.stop(); onClose(); }} head={head}>
            {recordings.length === 0 ? (
                <div className="space-y-3 rounded-2xl border-2 border-dashed border-stone-200 bg-white p-6 text-center" data-testid="rf-day-empty">
                    <p className="m-0 text-[16px] font-bold text-stone-700">{copy.nothingTold(isToday)}</p>
                    {tellMore}
                </div>
            ) : (
                <>
                    <div data-testid="rf-day-parts">
                        <p className="m-0 mb-2 text-[13px] font-semibold text-stone-600">{copy.dayViewHint(isToday)}</p>
                        <div className="space-y-2">
                            {PARTS.filter(m => byPart[m.key].length > 0).map(m => (
                                <DayRow key={m.key} part={m.key} entries={withoutQuotes(byPart[m.key])} byLog={byLog} touched={freshParts.has(m.key)} showWho nowIds={fresh} defaultOpen />
                            ))}
                            {blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                        </div>
                    </div>
                    <div data-testid="rf-day-times">
                        <h3 className="m-0 mb-1.5 text-[13px] font-extrabold text-stone-700">{copy.timesTitle}</h3>
                        <RecordingTimes recordings={recordings} listen={listen} openKey={openKey} fresh={fresh} onEdit={onEdit} />
                    </div>
                    {tellMore}
                </>
            )}
        </Sheet>
    );
};

/** One block of the day's work screen: a plot that had work that day, or the whole farm. */
export interface FeedBlock {
    key: string;
    /** "सोनाका" (the plot), or the whole farm. */
    title: string;
    /** "द्राक्ष" — the crop, in his language. */
    subtitle?: string;
    crop?: { iconName: string; name: string };
    recordings: DayRecording[];
}

/** The day's work (behind the "आजचा आढावा" button): one block per place, its time chips, a recording opened in place. */
export const DayFeedSheet: React.FC<{
    blocks: readonly FeedBlock[];
    isToday: boolean;
    dayLabel: string;
    listen: DayListen;
    onEdit?: (log: DailyLog) => void;
    onClose: () => void;
}> = ({ blocks, isToday, dayLabel, listen, onEdit, onClose }) => {
    const copy = useReflectCopy();
    return (
        <Sheet testId="rf-feed" label={copy.feedTitle(isToday)} z="z-[55]" onBack={() => { listen.stop(); onClose(); }}>
            <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="m-0 text-[20px] font-extrabold tracking-tight text-stone-900" data-testid="rf-feed-title">{copy.feedTitle(isToday)}</h3>
                <span className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[13px] font-bold text-stone-700 shadow-sm" data-testid="rf-feed-date">{dayLabel}</span>
            </div>
            {blocks.length === 0
                ? <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50 p-8 text-center text-[16px] font-semibold text-stone-600" data-testid="rf-feed-empty">{copy.feedEmpty(isToday)}</div>
                : blocks.map(b => (
                    <section key={b.key} className="rounded-[18px] border border-stone-200 bg-white p-3" data-testid={`rf-feed-block-${b.key}`}>
                        <div className="mb-2.5 flex items-center gap-2.5">
                            {b.crop
                                ? <CropPhoto iconName={b.crop.iconName} name={b.crop.name} px={44} />
                                : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800" aria-hidden="true"><MapIcon size={22} /></span>}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[18px] font-extrabold leading-tight text-stone-900">{b.title}</span>
                                <span className="block text-[13px] font-bold text-stone-500" data-testid={`rf-feed-block-${b.key}-times`}>
                                    {[b.subtitle, copy.timesTold(b.recordings.length, isToday)].filter(Boolean).join(' · ')}
                                </span>
                            </span>
                        </div>
                        <RecordingTimes recordings={b.recordings} listen={listen} idPrefix={`${b.key}-`} onEdit={onEdit} showKey={false} />
                    </section>
                ))}
            {blocks.length > 0 && <p className="m-0 px-1 text-[12.5px] font-semibold text-stone-600">{copy.timesKey}</p>}
        </Sheet>
    );
};
