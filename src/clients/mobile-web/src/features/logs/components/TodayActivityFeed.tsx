/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TodayActivityFeed — "today's timeline / activity feed", MOVED off the log page onto "माझं शेत"
 * (founder 2026-10-24: "one separate button for that, not on the log page but on the Reflect page").
 *
 * The log page now stays about ONE thing: telling Sathi what happened. The list of what has already been
 * recorded today lives one tap away on "माझं शेत", behind `TodayActivityButton`, and opens in
 * `TodayActivitySheet`. The cards are `ActivityFeedCard`s: everything the old `DailyLogCard` showed, readable, plus ▶ when a
 * recording exists. Tapping a card does what it did before (opens that log).
 *
 * Presentational: the caller supplies already-built `FeedEntry`s (see
 * `core/navigation/activityFeedEntries.ts`), so this file has no knowledge of the log store.
 * Every Marathi string below is PROPOSED (the English it replaces was never translated).
 */
import React from 'react';
import { ArrowLeft, ChevronRight, ListChecks } from 'lucide-react';
import type { DailyLog, TodayCounts } from '../../../types';
import ActivityFeedCard, { type CardAudio } from './ActivityFeedCard';
import { PHONE_COLUMN } from './phoneColumn';

const SANS = "'Noto Sans Devanagari', sans-serif";

/** One card of the feed, already resolved to display values. */
export interface FeedEntry {
    id: string;
    /** Real logs pass their id so attachments can be counted; sample/preview entries omit it. */
    logId?: string;
    workDone: string;
    plotName: string;
    cropName: string;
    cropColor: string;
    loggedBy: string;
    timeLabel: string;
    statusLabel: string;
    statusTone: 'pending' | 'rejected' | 'approved';
    counts?: Partial<TodayCounts>;
    summaryLines?: string[];
    /** What he said (two lines) and the recording behind this card, when there is one. */
    snippet?: string;
    audio?: CardAudio;
    chips?: React.ReactNode;
    /**
     * PLR-D10 I13 — the real log behind the card, so the sheet can find its clip on this phone and show
     * everything understood from it. Sample/preview entries omit it (then the card just opens).
     */
    log?: DailyLog;
    /** PLR-D10 I13 — the person holding this phone spoke it (the glance then shows his own name, like the result screen). */
    byYou?: boolean;
    onOpen: () => void;
}

/** PROPOSED Marathi — needs the Marathi review pass. */
export const FEED_STR = {
    title: 'आजचा आढावा',
    subtitle: 'आज कोणी काय केलं ते पाहा',
    empty: 'आज अजून काहीही सांगितलं नाही',
    back: 'मागे',
    hint: '▶ दाबा — बोलणं ऐकू येईल · कार्डावर दाबा — त्यातून काय समजलं ते सगळं दिसेल',
} as const;

/**
 * The one button on "माझं शेत". Lane RF: आढावा passes its own `title` / `subtitle` when the page is on another day
 * (and in English mode); without them the button reads as it always did.
 */
export const TodayActivityButton: React.FC<{ count: number; countLabel?: string; title?: string; subtitle?: string; onClick: () => void }> = ({ count, countLabel, title, subtitle, onClick }) => (
    <button type="button" onClick={onClick} data-testid="activity-feed-button"
        className="flex min-h-[64px] w-full items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left shadow-sm active:scale-[0.98]" style={{ fontFamily: SANS }}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-700 text-white"><ListChecks size={24} /></span>
        <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-extrabold leading-tight text-emerald-950">{title ?? FEED_STR.title}</span>
            <span className="block text-[14px] font-semibold leading-snug text-stone-700">{subtitle ?? FEED_STR.subtitle}</span>
        </span>
        {count > 0 && <span className="shrink-0 rounded-full bg-emerald-700 px-2.5 py-1 text-[14px] font-extrabold text-white" data-testid="activity-feed-count">{countLabel ?? count}</span>}
        <ChevronRight size={22} className="shrink-0 text-emerald-800" aria-hidden="true" />
    </button>
);

/** The list itself (what used to sit under the log page). */
export const TodayActivityFeed: React.FC<{ entries: readonly FeedEntry[]; dateLabel: string }> = ({ entries, dateLabel }) => (
    <div style={{ fontFamily: SANS }} data-testid="activity-feed">
        <div className="mb-3 flex items-center justify-between px-1">
            <h3 className="m-0 text-[20px] font-extrabold tracking-tight text-stone-900">{FEED_STR.title}</h3>
            <span className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[13px] font-bold text-stone-700 shadow-sm" data-testid="activity-feed-date">{dateLabel}</span>
        </div>
        {entries.some(e => e.audio) && <p className="m-0 mb-2 px-1 text-[13px] font-semibold leading-snug text-stone-700" data-testid="activity-feed-hint">{FEED_STR.hint}</p>}
        {entries.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50 p-8 text-center text-[16px] font-semibold text-stone-600" data-testid="activity-feed-empty">{FEED_STR.empty}</div>
        ) : (
            <div className="space-y-2">
                {entries.map(e => (
                    <ActivityFeedCard key={e.id} logId={e.logId} workDone={e.workDone} plotName={e.plotName} cropName={e.cropName} cropColor={e.cropColor}
                        loggedBy={e.loggedBy} timeLabel={e.timeLabel} statusTone={e.statusTone}
                        counts={e.counts} summaryLines={e.summaryLines} snippet={e.snippet} audio={e.audio} chips={e.chips}
                        attachmentCount={e.logId ? undefined : 0} onClick={e.onOpen} />
                ))}
            </div>
        )}
    </div>
);

/** The feed in a full-screen sheet over "माझं शेत", with one big back. */
export const TodayActivitySheet: React.FC<{ entries: readonly FeedEntry[]; dateLabel: string; onClose: () => void }> = ({ entries, dateLabel, onClose }) => (
    <div className="fixed inset-0 z-[55] flex justify-center bg-stone-900/30">
    <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={FEED_STR.title} data-testid="activity-feed-sheet">
        <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5">
            <button type="button" onClick={onClose} data-testid="activity-feed-back"
                className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95" style={{ fontFamily: SANS }}>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                <span className="text-[17px] font-extrabold">{FEED_STR.back}</span>
            </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-4"><TodayActivityFeed entries={entries} dateLabel={dateLabel} /></div>
    </div>
    </div>
);
