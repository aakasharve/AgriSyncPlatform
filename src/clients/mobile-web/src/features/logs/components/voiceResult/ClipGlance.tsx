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
 *
 * One recording that named several plots became one log per plot, and only the log carrying his words holds
 * the clip link: every plot's card of that recording plays that same clip and opens that same recording.
 */
import React, { useMemo, useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { clipScanFloor } from '../../../../infrastructure/voice/clipLogLink';
import type { DailyLog } from '../../../../types';
import { PHONE_COLUMN } from '../phoneColumn';
import { FEED_STR, TodayActivitySheet, type FeedEntry } from '../TodayActivityFeed';
import ClipPlayer, { mmss } from './ClipPlayer';
import { AddedRow, BlockerRow, TimePill, WhoChip } from './DayParts';
import { Words } from './HisWords';
import { blockersOf, groupByRecording, isConfirmed, markTranscript, partEntriesOf, primaryOf, type BlockerEntry } from './resultModel';
import { useResultStr } from './resultStrings';
import { clipSeconds, useClipPlayback, useLogClips, type AudioFactory } from './useClipPlayback';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { digitsFor } from '../../../../shared/utils/marathiDigits';

const SANS = "'Noto Sans Devanagari', sans-serif";

// PROPOSED (Marathi) — the preview's line for a recording nothing was understood from.
const NOTHING = 'या बोलण्यातून अजून काही समजलं नाही';

interface GlanceProps {
    entry: FeedEntry;
    /** Every log the recording behind this card became (the card's own log among them). */
    recording?: readonly DailyLog[];
    clip?: VoiceClipCacheRecord;
    playing: boolean;
    progress: number;
    lengthSec: number | null;
    onToggle: () => void;
    onEdit: () => void;
    onClose: () => void;
}

/** Full-screen: one recording, its words, its player, and everything understood from it. */
export const ClipGlanceSheet: React.FC<GlanceProps> = ({ entry, recording, clip, playing, progress, lengthSec, onToggle, onEdit, onClose }) => {
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const logs = recording && recording.length > 0 ? recording : entry.log ? [entry.log] : [];
    const said = primaryOf(logs)?.fullTranscript?.trim() ?? '';
    // Lane IT-D2 (founder D-123b): this sheet writes its numbers and times in Devanagari digits in Marathi mode.
    const entries = logs.flatMap(l => partEntriesOf(l, language, true));
    const blockers: BlockerEntry[] = logs.flatMap(l => blockersOf(l, language));
    const words = said ? markTranscript(said, entries) : [];
    const confirmed = logs.length > 0 && logs.every(isConfirmed);
    return (
        <div className="fixed inset-0 z-[60] flex justify-center bg-stone-900/30">
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={FEED_STR.title} data-testid="clip-glance" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onClose} data-testid="clip-glance-back"
                        className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{RS.back}</span>
                    </button>
                    <TimePill label={digitsFor(entry.timeLabel, language)} strong />
                    {/* Who spoke it, the result screen's way: a real name, the phone holder's own name too (lane IT5; never "तुम्ही"). */}
                    <WhoChip who={{ name: entry.loggedBy, you: !!entry.byYou }} testId="clip-glance-who" />
                    <span className={`text-[12px] font-extrabold ${confirmed ? 'text-emerald-700' : 'text-stone-600'}`} data-testid="clip-glance-state">
                        {confirmed ? `✔ ${RS.confirmedBadge}` : RS.notConfirmed}
                    </span>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">
                    {words.length > 0 && <Words runs={words} testId="clip-glance-words" />}
                    {clip && <ClipPlayer clipKey={clip.id} durationSec={lengthSec} playing={playing} progress={progress} big onToggle={onToggle} testId="clip-glance-play" nativeDigits={language !== 'en'} />}
                    <div data-testid="clip-glance-understood">
                        <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">{RS.addedTitle}</div>
                        {entries.length === 0 && blockers.length === 0 && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid="clip-glance-nothing">{NOTHING}</p>}
                        <div className="space-y-1.5">
                            {entries.map(e => <AddedRow key={e.id} entry={e} />)}
                            {blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                        </div>
                    </div>
                    <button type="button" onClick={onEdit} data-testid="clip-glance-edit"
                        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                        <Pencil size={18} aria-hidden="true" /> {RS.edit}
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
    // Each card's log → the recording it belongs to (all its logs) and the log that holds the clip link.
    const { recordingOf, clipLogOf, logs } = useMemo(() => {
        const real = entries.flatMap(e => (e.log ? [e.log] : []));
        const byLog = new Map<string, DailyLog[]>();
        for (const group of groupByRecording(real)) for (const l of group) byLog.set(l.id, group);
        return {
            logs: real,
            recordingOf: (logId: string) => byLog.get(logId),
            clipLogOf: (logId: string) => primaryOf(byLog.get(logId) ?? [])?.id ?? logId,
        };
    }, [entries]);
    const floor = useMemo(() => clipScanFloor(logs), [logs]);
    const { clips } = useLogClips(logs.map(l => l.id), floor);
    const playback = useClipPlayback(createAudio);
    const language = useOptionalLanguage()?.language;
    const [glanceId, setGlanceId] = useState<string | null>(null);

    // Playback is keyed by the log that holds the clip, so every plot's card of one recording shows it playing.
    const clipFor = (logId: string) => clips.get(clipLogOf(logId));
    const lengthOf = (logId: string) => clipSeconds(clipLogOf(logId), clipFor(logId), playback.lengths);
    const isPlaying = (logId: string) => playback.playingId === clipLogOf(logId);
    const toggle = (logId: string) => { const clip = clipFor(logId); if (clip) void playback.toggle(clipLogOf(logId), clip); };

    const wired: FeedEntry[] = entries.map(e => {
        const clip = e.logId ? clipFor(e.logId) : undefined;
        const len = e.logId ? lengthOf(e.logId) : null;
        const playing = !!e.logId && isPlaying(e.logId);
        return {
            ...e,
            audio: clip && e.logId
                ? { durationLabel: len == null ? '' : digitsFor(playing ? `${mmss(playback.progress * len)} / ${mmss(len)}` : mmss(len), language), playing, onToggle: () => toggle(e.logId as string) }
                : e.audio,
            onOpen: e.log ? () => { playback.stop(); setGlanceId(e.id); } : e.onOpen,
        };
    });
    const open = glanceId ? entries.find(e => e.id === glanceId) : undefined;

    return (
        <>
            <TodayActivitySheet entries={wired} dateLabel={dateLabel} onClose={() => { playback.stop(); onClose(); }} />
            {open && (
                <ClipGlanceSheet entry={open} recording={open.logId ? recordingOf(open.logId) : undefined}
                    clip={open.logId ? clipFor(open.logId) : undefined}
                    playing={!!open.logId && isPlaying(open.logId)} progress={playback.progress}
                    lengthSec={open.logId ? lengthOf(open.logId) : null} onToggle={() => open.logId && toggle(open.logId)}
                    onEdit={() => { playback.stop(); setGlanceId(null); open.onOpen(); }}
                    onClose={() => { playback.stop(); setGlanceId(null); }} />
            )}
        </>
    );
};

export default TodayActivityClipsSheet;
