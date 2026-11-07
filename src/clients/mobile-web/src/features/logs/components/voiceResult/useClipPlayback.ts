/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-12, LP-15, LP-24)
 *
 * The clips of a set of logs that are ON THIS PHONE, and one player for them. "Heard" means played to the
 * END (founder PLR-D1 round 2: "confirm unlocked after his clip is heard"); pausing half-way is not hearing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { clipsForLogs, readClipAudio } from '../../../../infrastructure/voice/clipLogLink';
import { usePlaybackSwitch } from './playbackSwitch';

export interface LogClips {
    /** The clips (on this phone) of these logs, keyed by log id; a log with no clip is simply absent. */
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    /**
     * False until this phone has been asked once. Until then "no clip" is not yet KNOWN, so nothing may act on
     * it. (PLR-D10 I27: the owner's confirm no longer waits on it — D-44 never makes listening compulsory.)
     */
    ready: boolean;
}

/** `recordedSinceUtc` narrows the scan to clips recorded since then (see `clipScanFloor`); absent = all clips. */
export function useLogClips(logIds: readonly string[], recordedSinceUtc?: string): LogClips {
    const [clips, setClips] = useState<ReadonlyMap<string, VoiceClipCacheRecord>>(() => new Map());
    const [ready, setReady] = useState(false);
    const key = [...logIds].sort().join(',');
    useEffect(() => {
        let cancelled = false;
        clipsForLogs(key ? key.split(',') : [], recordedSinceUtc)
            .then(found => { if (!cancelled) { setClips(found); setReady(true); } })
            .catch(() => { if (!cancelled) { setClips(new Map()); setReady(true); } });
        return () => { cancelled = true; };
    }, [key, recordedSinceUtc]);
    return { clips, ready };
}

export interface ClipPlayback {
    playingId: string | null;
    progress: number;
    /** Length in seconds of the clip that is (or was last) loaded, keyed by log id. */
    lengths: ReadonlyMap<string, number>;
    /** Logs whose clip he listened to the end. */
    heard: ReadonlySet<string>;
    toggle: (logId: string, clip: VoiceClipCacheRecord) => Promise<void>;
    stop: () => void;
}

export type AudioFactory = (url: string) => HTMLAudioElement;
const defaultAudio: AudioFactory = url => new Audio(url);

export function useClipPlayback(createAudio: AudioFactory = defaultAudio): ClipPlayback {
    // Fix round 3 (M1): the one player behind the result screen, today's activity and the day listen obeys the playback switch. Known OFF
    // blocks (nothing opens, nothing plays; a clip that is playing stops); ON and unknown do not.
    const playbackAllowed = usePlaybackSwitch();
    const switchOff = playbackAllowed === false;
    const audio = useRef<HTMLAudioElement | null>(null);
    const url = useRef<string | null>(null);
    // Opening a clip is a decrypt (async). Every start or stop takes a new ticket; a decrypt that finishes under an
    // old ticket (stopped, another clip asked for, the screen left) is dropped — never a second, unstoppable player.
    const ticket = useRef(0);
    const loading = useRef<string | null>(null);
    const mounted = useRef(true);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [lengths, setLengths] = useState<ReadonlyMap<string, number>>(() => new Map());
    const [heard, setHeard] = useState<ReadonlySet<string>>(() => new Set());

    const release = useCallback(() => {
        const a = audio.current;
        if (a) { a.onended = null; a.ontimeupdate = null; a.onloadedmetadata = null; a.pause(); }
        audio.current = null;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = null;
    }, []);

    const stop = useCallback(() => {
        ticket.current += 1;
        loading.current = null;
        release();
        if (mounted.current) { setPlayingId(null); setProgress(0); }
    }, [release]);

    const toggle = useCallback(async (logId: string, clip: VoiceClipCacheRecord) => {
        if (switchOff) return; // OFF: no player is ever created
        if (loading.current === logId) return; // a second tap while it opens: the first one plays
        if (playingId === logId) { stop(); return; }
        stop();
        const mine = ticket.current;
        loading.current = logId;
        const blob = await readClipAudio(clip).catch(() => null);
        if (mine !== ticket.current || !mounted.current) return;
        loading.current = null;
        if (!blob) return;
        const src = URL.createObjectURL(blob);
        const a = createAudio(src);
        audio.current = a;
        url.current = src;
        const noteLength = () => {
            if (Number.isFinite(a.duration) && a.duration > 0) setLengths(m => new Map(m).set(logId, a.duration));
        };
        a.onloadedmetadata = noteLength;
        a.ontimeupdate = () => { noteLength(); setProgress(a.duration > 0 ? Math.min(1, a.currentTime / a.duration) : 0); };
        a.onended = () => { setHeard(h => new Set(h).add(logId)); stop(); };
        setPlayingId(logId);
        setProgress(0);
        try { await a.play(); } catch { if (mine === ticket.current) stop(); } // a later tap's player is not stopped
    }, [switchOff, playingId, stop, createAudio]);

    useEffect(() => {
        if (switchOff) stop();
    }, [switchOff, stop]);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; ticket.current += 1; loading.current = null; release(); };
    }, [release]);

    return { playingId, progress, lengths, heard, toggle, stop };
}

/** The length to show for a log's clip: what the player measured, else what the recorder wrote, else unknown. */
export const clipSeconds = (logId: string, clip: VoiceClipCacheRecord | undefined, lengths: ReadonlyMap<string, number>): number | null =>
    lengths.get(logId) ?? (clip?.durationMs ? clip.durationMs / 1000 : null);
