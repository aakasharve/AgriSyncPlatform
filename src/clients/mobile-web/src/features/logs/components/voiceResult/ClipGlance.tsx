/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-24, V-5) — today's activity feed with
 * its recordings, ported from the approved preview (postVoiceResult/ClipGlance.tsx, ReflectActivityPreview).
 *
 * In the feed on आढावा: ▶ on a card ONLY when that log's clip is on this phone (never a guessed clip), plus a
 * snippet of his words. Pressing a card opens everything understood from that one recording (his marked
 * words, the player, part by part) instead of jumping straight into the edit form; "बदला" there still opens
 * the edit form, so nothing is lost. A card with no real log behind it opens as it always did.
 */
import React, { useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { PHONE_COLUMN } from '../phoneColumn';
import { FEED_STR, TodayActivitySheet, type FeedEntry } from '../TodayActivityFeed';
import ClipPlayer, { mmss } from './ClipPlayer';
import { AddedRow, TimePill } from './DayParts';
import { Words } from './HisWords';
import { isConfirmed, markTranscript, partEntriesOf } from './resultModel';
import { RESULT_STR } from './resultStrings';
import { clipSeconds, useClipPlayback, useLogClips, type AudioFactory } from './useClipPlayback';

const SANS = "'Noto Sans Devanagari', sans-serif";

// PROPOSED (Marathi) — the preview's line for a recording nothing was understood from.
const NOTHING = 'या बोलण्यातून अजून काही समजलं नाही';

interface GlanceProps {
    entry: FeedEntry;
    clip?: VoiceClipCacheRecord;
    playing: boolean;
    progress: number;
    lengthSec: number | null;
    onToggle: () => void;
    onEdit: () => void;
    onClose: () => void;
}

/** Full-screen: one recording, its words, its player, and everything understood from it. */
export const ClipGlanceSheet: React.FC<GlanceProps> = ({ entry, clip, playing, progress, lengthSec, onToggle, onEdit, onClose }) => {
    const log = entry.log;
    const entries = log ? partEntriesOf(log) : [];
    const words = log?.fullTranscript ? markTranscript(log.fullTranscript.trim(), entries) : [];
    const confirmed = log ? isConfirmed(log) : false;
    return (
        <div className="fixed inset-0 z-[60] flex justify-center bg-stone-900/30">
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={FEED_STR.title} data-testid="clip-glance" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onClose} data-testid="clip-glance-back"
                        className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{RESULT_STR.back}</span>
                    </button>
                    <TimePill label={entry.timeLabel} strong />
                    <span className="text-[12px] font-extrabold text-stone-700">{entry.loggedBy}</span>
                    <span className={`text-[12px] font-extrabold ${confirmed ? 'text-emerald-700' : 'text-stone-600'}`} data-testid="clip-glance-state">
                        {confirmed ? `✔ ${RESULT_STR.confirmedBadge}` : RESULT_STR.notConfirmed}
                    </span>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">
                    {words.length > 0 && <Words runs={words} testId="clip-glance-words" />}
                    {clip && <ClipPlayer clipKey={clip.id} durationSec={lengthSec} playing={playing} progress={progress} big onToggle={onToggle} testId="clip-glance-play" />}
                    <div data-testid="clip-glance-understood">
                        <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">{RESULT_STR.addedTitle}</div>
                        {entries.length === 0 && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid="clip-glance-nothing">{NOTHING}</p>}
                        <div className="space-y-1.5">{entries.map(e => <AddedRow key={e.id} entry={e} />)}</div>
                    </div>
                    <button type="button" onClick={onEdit} data-testid="clip-glance-edit"
                        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                        <Pencil size={18} aria-hidden="true" /> {RESULT_STR.edit}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** The feed's sheet with the recordings wired in: ▶ where this phone holds the clip, a glance on press. */
export const TodayActivityClipsSheet: React.FC<{ entries: readonly FeedEntry[]; dateLabel: string; onClose: () => void; createAudio?: AudioFactory }> = ({
    entries, dateLabel, onClose, createAudio,
}) => {
    const clips = useLogClips(entries.flatMap(e => (e.log && e.logId ? [e.logId] : [])));
    const playback = useClipPlayback(createAudio);
    const [glanceId, setGlanceId] = useState<string | null>(null);

    const lengthOf = (logId: string) => clipSeconds(logId, clips.get(logId), playback.lengths);
    const toggle = (logId: string) => { const clip = clips.get(logId); if (clip) void playback.toggle(logId, clip); };

    const wired: FeedEntry[] = entries.map(e => {
        const clip = e.logId ? clips.get(e.logId) : undefined;
        const len = e.logId ? lengthOf(e.logId) : null;
        const playing = !!e.logId && playback.playingId === e.logId;
        return {
            ...e,
            audio: clip && e.logId
                ? { durationLabel: len == null ? '' : playing ? `${mmss(playback.progress * len)} / ${mmss(len)}` : mmss(len), playing, onToggle: () => toggle(e.logId as string) }
                : e.audio,
            onOpen: e.log ? () => { playback.stop(); setGlanceId(e.id); } : e.onOpen,
        };
    });
    const open = glanceId ? entries.find(e => e.id === glanceId) : undefined;

    return (
        <>
            <TodayActivitySheet entries={wired} dateLabel={dateLabel} onClose={() => { playback.stop(); onClose(); }} />
            {open && (
                <ClipGlanceSheet entry={open} clip={open.logId ? clips.get(open.logId) : undefined}
                    playing={!!open.logId && playback.playingId === open.logId} progress={playback.progress}
                    lengthSec={open.logId ? lengthOf(open.logId) : null} onToggle={() => open.logId && toggle(open.logId)}
                    onEdit={() => { playback.stop(); setGlanceId(null); open.onOpen(); }}
                    onClose={() => { playback.stop(); setGlanceId(null); }} />
            )}
        </>
    );
};

export default TodayActivityClipsSheet;
