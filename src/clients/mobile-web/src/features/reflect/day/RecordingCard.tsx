/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — ONE recording on आढावा, the way the voice result
 * screen shows it (founder 2026-10-30: what work, who did it, when, where you can listen).
 *
 * Two sizes of the same thing:
 *   - `RecordingRow` — one line of the day's work (the feed): when, who ("तुम्ही" for the person holding this phone),
 *     "लिहिलेलं" for a typed entry, the ONE status wording, the first thing understood, where, a snippet of his words,
 *     the products as chips, the old-entry line for a record the server holds only as task lines, and ▶ when the clip
 *     is on this phone. Pressing it opens the glance.
 *   - `RecordingCard` — the glance and each recording of a plot's day: the same head, his words marked as the result
 *     screen marks them, ▶ (or the typed note where the player would be), everything understood part by part with
 *     the spray / drip boxes, the stoppages, the photos, and "बदला" for each of its logs.
 * Every value is the record's own, as said; nothing is summed across recordings (P4).
 */
import React from 'react';
import { ChevronRight, Pencil } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { DailyLog } from '../../../types';
import { AddedRow, BlockerRow, LegacyNote, TimePill, TypedNote, TypedTag, WhoChip } from '../../logs/components/voiceResult/DayParts';
import { Words } from '../../logs/components/voiceResult/HisWords';
import { AddedProducts, ProductBoxCard } from '../../logs/components/voiceResult/ProductRows';
import { showsProducts, type ProductBox } from '../../logs/components/voiceResult/productModel';
import { markTranscript, type PartEntry } from '../../logs/components/voiceResult/resultModel';
import type { DayRecording } from './dayRecordings';
import { ListenControl, LogPhotos, PlaceLine, StatusChip, useReflectCopy } from './RecordingParts';
import type { DayListen } from './useDayListen';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";

/** The product boxes of a recording (only what was verified and can be shown in this language), and the rest. */
function splitProducts(entries: readonly PartEntry[], language: string | null | undefined): { boxes: ProductBox[]; others: PartEntry[] } {
    const boxed = (e: PartEntry) => e.verified && showsProducts(e.products, language);
    return {
        boxes: entries.flatMap(e => (boxed(e) && e.products ? [e.products] : [])),
        others: entries.filter(e => !boxed(e)),
    };
}

/** When, who, typed, confirmed — the head every view of a recording starts with. */
const RecordingHead: React.FC<{ rec: DayRecording; testId: string }> = ({ rec, testId }) => (
    <span className="flex flex-wrap items-center gap-1.5">
        <TimePill label={rec.view.timeLabel} strong />
        <WhoChip who={rec.view.who} testId={`${testId}-who`} />
        {rec.view.typed && <TypedTag testId={`${testId}-typed`} />}
        <StatusChip confirmed={rec.view.confirmed} testId={`${testId}-state`} />
    </span>
);

const plotOf = (log: DailyLog): string => (log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean).join(', ');

export const RecordingCard: React.FC<{
    rec: DayRecording;
    listen: DayListen;
    testId: string;
    big?: boolean;
    showPlace?: boolean;
    onEdit?: (log: DailyLog) => void;
}> = ({ rec, listen, testId, big, showPlace, onEdit }) => {
    const language = useOptionalLanguage()?.language;
    const copy = useReflectCopy();
    const { view } = rec;
    const { boxes, others } = splitProducts(view.entries, language);
    const runs = view.transcript ? markTranscript(view.transcript, view.entries) : [];
    const nothing = others.length === 0 && boxes.length === 0 && view.blockers.length === 0;
    return (
        <section data-testid={testId} data-confirmed={view.confirmed ? 'yes' : 'no'} data-legacy={view.legacyPartial ? 'yes' : 'no'}
            className="rounded-2xl border border-stone-200 bg-white p-3" style={{ fontFamily: SANS }}>
            <RecordingHead rec={rec} testId={testId} />
            {showPlace && <div className="mt-1.5"><PlaceLine rec={rec} testId={`${testId}-place`} /></div>}
            {view.legacyPartial && <LegacyNote testId={`${testId}-legacy`} />}
            {runs.length > 0 && <Words runs={runs} size="text-[16px]" testId={`${testId}-words`} />}
            {view.typed ? <div className="mt-2"><TypedNote testId={`${testId}-typed-note`} /></div> : <ListenControl rec={rec} listen={listen} big={big} testId={`${testId}-play`} />}
            <div className="mt-3" data-testid={`${testId}-understood`}>
                <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">{copy.understood}</div>
                {nothing && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid={`${testId}-nothing`}>{copy.nothingUnderstood}</p>}
                <div className="space-y-1.5">
                    {others.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}
                    {boxes.map(b => <ProductBoxCard key={b.id} box={b} />)}
                    {view.blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                </div>
            </div>
            {rec.logs.map(l => <LogPhotos key={l.id} logId={l.id} />)}
            {onEdit && rec.logs.map(l => (
                <button key={l.id} type="button" onClick={() => { listen.stop(); onEdit(l); }} data-testid={`${testId}-edit-${l.id}`}
                    className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                    <Pencil size={18} aria-hidden="true" /> {copy.edit}{rec.logs.length > 1 && plotOf(l) ? ` · ${plotOf(l)}` : ''}
                </button>
            ))}
        </section>
    );
};

export const RecordingRow: React.FC<{ rec: DayRecording; listen: DayListen; testId: string; onOpen: () => void }> = ({ rec, listen, testId, onOpen }) => {
    const language = useOptionalLanguage()?.language;
    const { view } = rec;
    const { boxes } = splitProducts(view.entries, language);
    const clip = listen.kindOf(rec) === 'clip';
    return (
        <div data-testid={testId} data-confirmed={view.confirmed ? 'yes' : 'no'}
            className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" style={{ fontFamily: SANS }}>
            <div className={`absolute bottom-0 left-0 top-0 w-1.5 ${rec.cropColor}`} aria-hidden="true" />
            <button type="button" onClick={onOpen} data-testid={`${testId}-open`}
                className="flex min-h-[52px] w-full items-center gap-2 py-2 pl-3.5 pr-2 text-left active:bg-stone-50">
                <span className="min-w-0 flex-1">
                    <RecordingHead rec={rec} testId={testId} />
                    <span className="mt-1 block text-[17px] font-extrabold leading-tight text-stone-900" data-testid={`${testId}-work`}>{rec.headline}</span>
                    <span className="mt-0.5 block"><PlaceLine rec={rec} testId={`${testId}-place`} /></span>
                    {view.transcript && <span className="mt-1 line-clamp-2 block text-[14px] leading-snug text-stone-800" style={{ fontFamily: SERIF }} data-testid={`${testId}-snippet`}>{view.transcript}</span>}
                </span>
                <ChevronRight size={20} className="shrink-0 text-stone-500" aria-hidden="true" />
            </button>
            {(boxes.length > 0 || clip || view.legacyPartial) && (
                <div className="space-y-1.5 pb-2 pl-3.5 pr-2">
                    {/* Outside the row's button: the line is a block (a div inside a button is not valid HTML). */}
                    {view.legacyPartial && <LegacyNote testId={`${testId}-legacy`} />}
                    {boxes.length > 0 && <AddedProducts boxes={boxes} />}
                    {clip && <ListenControl rec={rec} listen={listen} testId={`${testId}-play`} />}
                </div>
            )}
        </div>
    );
};
