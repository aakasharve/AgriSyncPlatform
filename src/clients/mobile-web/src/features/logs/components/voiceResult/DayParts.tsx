/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-14, LP-15, LP-21) — the plot's WHOLE DAY.
 *
 * Founder PLR-D1 rounds 2-3: "current = glanceable, older = clickable". What this recording ADDED is
 * highlighted ("यातून काय समजलं"); one row per part for the day, open when this recording touched it, with
 * every entry tied to the time (and speaker) of the recording it came from; the day's earlier recordings are
 * listed NEWEST FIRST, each playable when its clip is on this phone, each "पक्कं केलं" or "पक्कं नाही".
 * Nothing is summed (P4): there is no total on this screen, so nothing needs the "आपोआप मोजलं" label.
 */
import React, { useState } from 'react';
import { ChevronDown, User } from 'lucide-react';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import ClipPlayer from './ClipPlayer';
import { PartIcon, Words } from './HisWords';
import { markTranscript, partMeta, type PartEntry, type PartKey, type RecordingView, type Who } from './resultModel';
import { RESULT_STR } from './resultStrings';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";

export const TimePill: React.FC<{ label: string; strong?: boolean }> = ({ label, strong }) => (
    label ? <span className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${strong ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-stone-300 bg-stone-100 text-stone-700'}`}>{label}</span> : null
);

/** WHO spoke a recording: "तुम्ही" for the person holding this phone, else the name recorded with the log. */
export const WhoChip: React.FC<{ who: Who; testId?: string }> = ({ who, testId }) => (
    <span data-testid={testId} data-you={who.you ? 'yes' : 'no'}
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${who.you ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
        <User size={12} aria-hidden="true" />{who.name}
    </span>
);

/** One thing this recording added. */
export const AddedRow: React.FC<{ entry: PartEntry }> = ({ entry }) => {
    const m = partMeta(entry.part);
    return (
        <div data-testid={`vr-added-${entry.id}`} data-part={entry.part} className="flex items-start gap-2.5 rounded-xl border-l-4 border-emerald-600 bg-emerald-50 p-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: m.tint }}><PartIcon part={entry.part} size={24} /></span>
            <div className="min-w-0 flex-1">
                <div className="text-[12px] font-extrabold text-stone-600">{m.label}</div>
                {entry.value && <div className="text-[20px] font-extrabold leading-tight text-stone-900" style={{ fontFamily: SANS }}>{entry.value}</div>}
                {entry.quote && entry.quote !== entry.value && (
                    <div className="mt-0.5 text-[13px] text-stone-700"><mark className="rounded px-1 text-inherit" style={{ background: m.tint }}>“{entry.quote}”</mark></div>
                )}
            </div>
        </div>
    );
};

/** One glanceable line per part for the whole day; open when this recording touched it, else one tap away. */
export const DayRow: React.FC<{ part: PartKey; entries: readonly PartEntry[]; byLog: ReadonlyMap<string, RecordingView>; touched: boolean; showWho: boolean; nowIds: ReadonlySet<string> }> = ({
    part, entries, byLog, touched, showWho, nowIds,
}) => {
    const [open, setOpen] = useState(touched);
    const m = partMeta(part);
    const last = entries[0];
    return (
        <section data-testid={`vr-day-${part}`} data-open={open ? 'yes' : 'no'} data-touched={touched ? 'yes' : 'no'}
            className={`rounded-2xl border bg-white ${touched ? 'border-emerald-400' : 'border-stone-200'}`}>
            <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid={`vr-day-row-${part}`} className="flex w-full items-center gap-2.5 p-2.5 text-left">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: m.tint }}><PartIcon part={part} size={22} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-extrabold text-stone-600">{m.label}</span>
                    <span className="block truncate text-[16px] font-extrabold text-stone-900">{last?.value ?? last?.quote ?? ''}</span>
                </span>
                {touched && <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 text-[12px] font-extrabold text-white">{RESULT_STR.newTag}</span>}
                <ChevronDown size={18} className={`shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open && (
                <div className="space-y-1.5 border-t border-stone-100 p-2.5" data-testid={`vr-day-history-${part}`}>
                    {entries.map(e => {
                        const rec = byLog.get(e.logId);
                        const isNew = nowIds.has(e.logId);
                        return (
                            <div key={e.id} data-testid={`vr-day-entry-${e.id}`} className={`rounded-xl border-l-4 px-2.5 py-1.5 ${isNew ? 'border-emerald-600 bg-emerald-50' : 'border-stone-300 bg-white'}`}>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {rec && <TimePill label={rec.timeLabel} strong={isNew} />}
                                    {rec && showWho && <WhoChip who={rec.who} />}
                                </div>
                                {e.value && <div className="text-[18px] font-extrabold leading-tight text-stone-900">{e.value}</div>}
                                {e.quote && e.quote !== e.value && <div className="mt-0.5 text-[12.5px] text-stone-700"><mark className="rounded px-1 text-inherit" style={{ background: m.tint }}>{e.quote}</mark></div>}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

/** One of the day's earlier recordings: time, who, confirmed or not, his words, and ▶ when its clip is on this phone. */
export const EarlierRecording: React.FC<{
    rec: RecordingView; clip?: VoiceClipCacheRecord; playing: boolean; progress: number; lengthSec: number | null; onToggle: () => void;
}> = ({ rec, clip, playing, progress, lengthSec, onToggle }) => (
    <details data-testid={`vr-earlier-${rec.id}`} className="rounded-2xl border border-stone-200 bg-white p-2.5">
        <summary className="flex cursor-pointer list-none items-center gap-2">
            <TimePill label={rec.timeLabel} />
            <WhoChip who={rec.who} testId={`vr-earlier-who-${rec.id}`} />
            <span className="min-w-0 flex-1 truncate text-sm text-stone-700" style={{ fontFamily: SERIF }}>{rec.transcript}</span>
            <span className={`shrink-0 text-[12px] font-extrabold ${rec.confirmed ? 'text-emerald-700' : 'text-stone-600'}`} data-testid={`vr-earlier-state-${rec.id}`}>
                {rec.confirmed ? `✔ ${RESULT_STR.confirmedBadge}` : RESULT_STR.notConfirmed}
            </span>
        </summary>
        <div className="mt-2">
            {rec.transcript && <Words runs={markTranscript(rec.transcript, rec.entries)} size="text-[16px]" testId={`vr-earlier-words-${rec.id}`} />}
            {clip && <ClipPlayer clipKey={clip.id} durationSec={lengthSec} playing={playing} progress={progress} onToggle={onToggle} testId={`vr-earlier-play-${rec.id}`} />}
        </div>
    </details>
);
