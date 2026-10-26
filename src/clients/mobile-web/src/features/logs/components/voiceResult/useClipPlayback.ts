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

/** The clips (on this phone) of these logs, keyed by log id. Empty until read; a log with no clip is simply absent. */
export function useLogClips(logIds: readonly string[]): ReadonlyMap<string, VoiceClipCacheRecord> {
    const [clips, setClips] = useState<ReadonlyMap<string, VoiceClipCacheRecord>>(() => new Map());
    const key = [...logIds].sort().join(',');
    useEffect(() => {
        let cancelled = false;
        clipsForLogs(key ? key.split(',') : [])
            .then(found => { if (!cancelled) setClips(found); })
            .catch(() => { if (!cancelled) setClips(new Map()); });
        return () => { cancelled = true; };
    }, [key]);
    return clips;
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
    const audio = useRef<HTMLAudioElement | null>(null);
    const url = useRef<string | null>(null);
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

    const stop = useCallback(() => { release(); setPlayingId(null); setProgress(0); }, [release]);

    const toggle = useCallback(async (logId: string, clip: VoiceClipCacheRecord) => {
        if (playingId === logId) { stop(); return; }
        stop();
        const blob = await readClipAudio(clip);
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
        try { await a.play(); } catch { stop(); }
    }, [playingId, stop, createAudio]);

    useEffect(() => release, [release]);

    return { playingId, progress, lengths, heard, toggle, stop };
}

/** The length to show for a log's clip: what the player measured, else what the recorder wrote, else unknown. */
export const clipSeconds = (logId: string, clip: VoiceClipCacheRecord | undefined, lengths: ReadonlyMap<string, number>): number | null =>
    lengths.get(logId) ?? (clip?.durationMs ? clip.durationMs / 1000 : null);
