/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF) — ONE player for the whole आढावा page: the day's
 * recordings whose clip is on this phone (the result screen's own `useLogClips` + `useClipPlayback`), keyed by the
 * log that carries his words, so every view of one recording (feed, glance, plot sheet, note) plays the same clip
 * and shows it playing. Where ▶ may be offered at all is `listenModel.ts`.
 */
import { useMemo } from 'react';
import type { VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { clipScanFloor } from '../../../infrastructure/voice/clipLogLink';
import { clipSeconds, useClipPlayback, useLogClips, type AudioFactory } from '../../logs/components/voiceResult/useClipPlayback';
import type { DayRecording } from './dayRecordings';
import { farmOfLog, listenKind, type ListenKind, type Viewer } from './listenModel';

export interface DayListen {
    kindOf: (rec: DayRecording) => ListenKind;
    clipOf: (rec: DayRecording) => VoiceClipCacheRecord | undefined;
    playing: (rec: DayRecording) => boolean;
    progress: number;
    lengthOf: (rec: DayRecording) => number | null;
    toggle: (rec: DayRecording) => void;
    stop: () => void;
    farmOf: (rec: DayRecording) => string | null;
}

export function useDayListen(recordings: readonly DayRecording[], viewer: Viewer, createAudio?: AudioFactory): DayListen {
    const voiceLogs = useMemo(() => recordings.map(r => r.voiceLog), [recordings]);
    const floor = useMemo(() => clipScanFloor(voiceLogs), [voiceLogs]);
    const { clips } = useLogClips(voiceLogs.map(l => l.id), floor);
    const playback = useClipPlayback(createAudio);

    const clipOf = (rec: DayRecording) => clips.get(rec.voiceLog.id);
    return {
        kindOf: rec => listenKind(rec, !!clipOf(rec), viewer),
        clipOf,
        playing: rec => playback.playingId === rec.voiceLog.id,
        progress: playback.progress,
        lengthOf: rec => clipSeconds(rec.voiceLog.id, clipOf(rec), playback.lengths),
        toggle: rec => { const clip = clipOf(rec); if (clip) void playback.toggle(rec.voiceLog.id, clip); },
        stop: playback.stop,
        farmOf: rec => farmOfLog(rec.voiceLog, viewer),
    };
}
