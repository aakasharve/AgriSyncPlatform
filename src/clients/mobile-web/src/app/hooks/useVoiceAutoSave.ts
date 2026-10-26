/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-08, LP-12)
 *
 * The voice auto-save (founder decision 2026-09-02, PLR-D1 round 1): after a successful parse of a
 * RECORDING the log is saved at once — no review form, no Save tap — through the ONE real save path
 * (`handleAutoSave` → createFromVoice → confirmAndSave → sync queue), stamped `autoSavedFromVoice` so the
 * server keeps it unconfirmed until his own "पक्कं आहे".
 *
 * What it guarantees:
 *   - ONCE per recording. The same recording handed over twice (a re-render, a re-entry) never writes a
 *     second log; only a save that wrote NOTHING may be tried again (by the review form).
 *   - The result screen appears only AFTER the durable phone write (`onWritten` runs between the write and
 *     the 'success' status), so "लक्षात ठेवलं" is never said early.
 *   - The clip of this recording is linked to the log on this phone in that same window.
 *   - Not taken, so today's review form gets the parse: the हजेरी door (labour has its own result screen),
 *     a parse with nothing understood in it, and a save that wrote nothing. Nothing is ever lost.
 */
import { useCallback, useRef, useState } from 'react';
import type { AgriLogResponse, DailyLog } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { VoiceDraftSink, VoiceRecordingRef } from '../../features/voice/useVoiceRecorder.types';
import { linkClipToLog } from '../../infrastructure/voice/clipLogLink';
import { logger } from '../../infrastructure/observability/Logger';
import { isAutoSavableVoiceDraft } from '../helpers/autoSavedVoiceLog';
import type { UseLogCommandsResult } from './useLogCommands.types';
import type { LogIntent } from './useAppNavigation';

/** What the result screen needs about the recording he just made. */
export interface VoiceResultState {
    /** The logs this recording wrote (one per plot when he named several plots). */
    logIds: string[];
    /** The clip on this phone that holds the recording, or null when none was found. */
    clipId: string | null;
    /** One per recording: the understanding ring replays only for a new one. */
    key: string;
    /** Phrases the parse marked unclear, shown as he said them (never placed in a part by guess). */
    unclear: string[];
}

export interface UseVoiceAutoSaveProps {
    handleAutoSave: UseLogCommandsResult['handleAutoSave'];
    logIntent: LogIntent;
    setStatus: (status: 'success') => void;
    /** Injected for tests; the real link writes `dailyLogId` on the clip row. */
    linkClip?: (recording: VoiceRecordingRef, dailyLogId: string) => Promise<string | null>;
}

export const recordingKey = (r: VoiceRecordingRef): string => `${r.clipId ?? '-'}|${r.recordedAtUtc}`;

/** The log of a recording that carries his words (one record holds the day's facts); else the first. */
export const primaryLogOf = (logs: readonly DailyLog[]): DailyLog | undefined => logs.find(l => !!l.fullTranscript) ?? logs[0];

export function useVoiceAutoSave({ handleAutoSave, logIntent, setStatus, linkClip = linkClipToLog }: UseVoiceAutoSaveProps) {
    const [voiceResult, setVoiceResult] = useState<VoiceResultState | null>(null);
    // 'saving' while a save is in flight, 'saved' once it wrote. Absent = never handled (or wrote nothing).
    const handled = useRef(new Map<string, 'saving' | 'saved'>());

    const sink: VoiceDraftSink = useCallback(async (draft: AgriLogResponse, provenance: LogProvenance | undefined, recording: VoiceRecordingRef) => {
        if (logIntent === 'labour' || !isAutoSavableVoiceDraft(draft)) return false;
        const key = recordingKey(recording);
        const seen = handled.current.get(key);
        if (seen) {
            // Already written (or being written) for this recording: never a second copy.
            if (seen === 'saved') setStatus('success');
            return true;
        }
        handled.current.set(key, 'saving');
        try {
            const saved = await handleAutoSave(draft, provenance, {
                autoSavedFromVoice: true,
                onWritten: async (logs) => {
                    const primary = primaryLogOf(logs);
                    const clipId = primary ? await linkClip(recording, primary.id).catch(() => null) : null;
                    const unclear = (draft.unclearSegments ?? []).map(s => s.rawText?.trim() ?? '').filter(t => t.length > 0);
                    setVoiceResult({ logIds: logs.map(l => l.id), clipId, key, unclear });
                },
            });
            if (saved) {
                handled.current.set(key, 'saved');
                return true;
            }
        } catch (error) {
            logger.error('Voice auto-save hand-off failed', error);
        }
        handled.current.delete(key);
        return false;
    }, [handleAutoSave, logIntent, setStatus, linkClip]);

    const clearVoiceResult = useCallback(() => setVoiceResult(null), []);

    return { sink, voiceResult, clearVoiceResult };
}
