/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-08, LP-12)
 *
 * The voice auto-save (founder decision 2026-09-02, PLR-D1 round 1): after a successful parse of a
 * RECORDING the log is saved at once — no review form, no Save tap — through the ONE real save path
 * (`handleAutoSave` → createFromVoice → confirmAndSave → sync queue), stamped `autoSavedFromVoice` so the
 * server keeps it unconfirmed until an authorised confirmation (spec I27), and naming the recording's server id
 * (`voiceClipId`) so a reviewer allowed to check THIS record can hear it.
 *
 * What it guarantees:
 *   - ONCE per recording. The same recording handed over twice (a re-render, a re-entry) never writes a
 *     second log; only a save that wrote NOTHING may be tried again (by the review form).
 *   - The result screen appears only AFTER the durable phone write (`onWritten` runs between the write and
 *     the 'success' status), so "लक्षात ठेवलं" is never said early.
 *   - The clip of this recording is linked to the log on this phone in that same window.
 *   - Not taken, so today's review form gets the parse: the हजेरी door (labour has its own result screen),
 *     a parse with nothing understood in it, a parse that would MOVE the save to a plot the AI suggested
 *     (`suggestedContext` — he must choose that himself, never silently), and a save that wrote nothing.
 *     Nothing is ever lost.
 *   - The day-closure analytics event (`closure.submitted`, method 'voice') is sent once the save is on the
 *     phone, as the review form's Save tap sent it before (DWC v2 §2.8): the admin MIS counts closed days,
 *     action time and repeat use from it, and voice is now the main way a day is closed.
 *
 * Lane L6b (founder design `PostVoiceResultPreview.sendTyped` / `TypedLog.tsx`): what he TYPES to Sathi in the
 * "लिहून सांगा" sheet takes the same path — same waiting screen, same save, same result screen — with the
 * honest differences of having no recording: no clip is looked for or linked, no recording id rides the create,
 * and the log is marked typed (`typedEntry`) so every screen says "लिहिलेलं". It is a capture, not a deliberate
 * confirmation (founder D-44 / D-46), so it rides the create UNCONFIRMED exactly like a spoken auto-save: the
 * server's `autoSavedFromVoice` means "saved straight from Sathi's parse with no review tap — keep it Draft, no
 * self-attestation" (DailyLog.AutoSavedFromVoiceReason), and what he typed went through that same parse. The
 * closure event keeps method 'voice', the method the review form's Save tap sent for a typed Sathi draft before.
 */
import { useCallback, useRef, useState } from 'react';
import type { AgriLogResponse, DailyLog, LogScope } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { VoiceDraftSink, VoiceRecordingRef } from '../../features/voice/useVoiceRecorder.types';
import { archiveIdForRecording, linkClipToLog } from '../../infrastructure/voice/clipLogLink';
import { logger } from '../../infrastructure/observability/Logger';
import { emitClosureSubmitted } from '../../core/telemetry/eventEmitters';
import { isAutoSavableVoiceDraft, primaryLogOf } from '../helpers/autoSavedVoiceLog';
import { bindDraftDecline, draftDay } from '../../features/voice/draftFacts';
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
    /** Lane L6b — he typed it to Sathi: there is no recording behind it. */
    typed?: boolean;
    /**
     * The logs exactly as this phone wrote them. Since lane F1 the screen reads the saved RECORD (the server keeps
     * what Sathi understood and a pull hands it back whole); these stand in only until that record reaches the
     * history, never over it.
     */
    written?: DailyLog[];
}

/** Lane OF — how a parse he checked on "तपासा आणि जतन करा" is saved. */
export interface CheckedSave {
    /** Where he chose (the canonical crop → plot steps), or the plots it was spoken for. */
    scope: LogScope;
    /** The day he chose (`yyyy-MM-dd`); absent = today. */
    dateKey?: string;
    /** The recording it came from (named on the create and linked to the log), when there was one. */
    recording?: VoiceRecordingRef;
    /** Saved from आवाज नोंदी: the log tab is left as it was. */
    stayOnScreen?: boolean;
    /** Lane OF fix 1 (M1): this capture becomes logs only ONCE (an offline job's own key) — see `AutoSaveOptions.onceKey`. */
    onceKey?: string;
}

export interface UseVoiceAutoSaveProps {
    handleAutoSave: UseLogCommandsResult['handleAutoSave'];
    logIntent: LogIntent;
    setStatus: (status: 'success') => void;
    /** Injected for tests; the real link writes `dailyLogId` on the clip row. */
    linkClip?: (recording: VoiceRecordingRef, dailyLogId: string) => Promise<string | null>;
    /** PLR-D10 I27 — injected for tests; the real one names the recording's server id (undefined = none here). */
    archiveIdOf?: (recording: VoiceRecordingRef) => Promise<string | undefined>;
    /** The farm the save is for (the closure event names it; no farm, no event — as the review form did). */
    farmId?: string | null;
    /** Injected for tests; the real one validates and queues the analytics event. */
    emitClosure?: typeof emitClosureSubmitted;
}

/** How many of the eight parts the parse filled (the review form's `fields_used`, counted the same way). */
const partsFilled = (d: AgriLogResponse): number => [
    d.cropActivities, d.irrigation, d.labour, d.inputs, d.machinery, d.activityExpenses, d.observations, d.plannedTasks,
].filter(bucket => (bucket?.length ?? 0) > 0).length;

/** The AI wants this save on a plot he did not pick: only the review form may do that, in front of him. */
const movesThePlot = (d: AgriLogResponse): boolean => !!(d.suggestedContext?.cropId && d.suggestedContext?.plotId);

export const recordingKey = (r: VoiceRecordingRef): string => `${r.clipId ?? '-'}|${r.recordedAtUtc}`;

// The log of a recording that carries his words — moved to the helper (PLR-D10 I27 stamps the recording on it too).
export { primaryLogOf };

export function useVoiceAutoSave({
    handleAutoSave, logIntent, setStatus, linkClip = linkClipToLog, archiveIdOf = archiveIdForRecording, farmId = null,
    emitClosure = emitClosureSubmitted,
}: UseVoiceAutoSaveProps) {
    const [voiceResult, setVoiceResult] = useState<VoiceResultState | null>(null);
    // 'saving' while a save is in flight, 'saved' once it wrote. Absent = never handled (or wrote nothing).
    const handled = useRef(new Map<string, 'saving' | 'saved'>());

    const sink: VoiceDraftSink = useCallback(async (draft: AgriLogResponse, provenance: LogProvenance | undefined, recording: VoiceRecordingRef) => {
        if (logIntent === 'labour') return false;
        // Lane OF (D-58) — handed back, the screen that shows it says why (his words and what was understood stay).
        if (!isAutoSavableVoiceDraft(draft)) { bindDraftDecline(draft, 'unclear', recording); return false; }
        if (movesThePlot(draft)) { bindDraftDecline(draft, 'otherPlot', recording); return false; }
        const startedAt = Date.now();
        const key = recordingKey(recording);
        const seen = handled.current.get(key);
        if (seen) {
            // Already written (or being written) for this recording: never a second copy.
            if (seen === 'saved') setStatus('success');
            return true;
        }
        handled.current.set(key, 'saving');
        // L6b — typed to Sathi: no recording exists, so none is named, looked for or linked.
        const typed = recording.typed === true;
        try {
            // PLR-D10 I27 — name the recording on the create, so a reviewer allowed to check THIS record can hear it.
            const voiceClipId = typed ? undefined : await archiveIdOf(recording).catch(() => undefined);
            const dateKey = draftDay(draft);
            const saved = await handleAutoSave(draft, provenance, {
                autoSavedFromVoice: true,
                ...(typed && { typedEntry: true }),
                ...(voiceClipId && { voiceClipId }),
                ...(dateKey && { dateKey }),
                onWritten: async (logs) => {
                    const primary = primaryLogOf(logs);
                    const clipId = primary && !typed ? await linkClip(recording, primary.id).catch(() => null) : null;
                    const unclear = (draft.unclearSegments ?? []).map(s => s.rawText?.trim() ?? '').filter(t => t.length > 0);
                    setVoiceResult({ logIds: logs.map(l => l.id), clipId, key, unclear, written: logs, ...(typed && { typed: true }) });
                },
            });
            if (saved) {
                handled.current.set(key, 'saved');
                const primary = primaryLogOf(saved);
                if (farmId && primary) {
                    // From the moment he started speaking (else from the hand-over) to the phone's write.
                    const spokeAt = Date.parse(recording.recordedAtUtc);
                    try {
                        emitClosure({
                            farmId, logId: primary.id, method: 'voice',
                            durationMs: Math.max(0, Date.now() - (Number.isFinite(spokeAt) ? spokeAt : startedAt)),
                            fields_used: partsFilled(draft),
                        });
                    } catch (error) {
                        logger.warn('closure.submitted not sent for a voice save', { error: String(error) });
                    }
                }
                return true;
            }
        } catch (error) {
            logger.error('Voice auto-save hand-off failed', error);
        }
        handled.current.delete(key);
        bindDraftDecline(draft, 'notWritten', recording);
        return false;
    }, [handleAutoSave, logIntent, setStatus, linkClip, archiveIdOf, farmId, emitClosure]);

    /**
     * Lane OF (D-58 / D-59) — "जतन करा" on the "तपासा आणि जतन करा" screen: the parse he looked at, saved through the
     * SAME save (same unconfirmed capture, same clip link, same result screen), on the place and the day he chose there.
     * It is still a capture, not his confirmation (founder D-44 / D-46): only the primary owner confirms, on the result
     * screen. Resolves the logs once they are on the phone, or null when nothing was written (he can press again).
     */
    const saveChecked = useCallback(async (draft: AgriLogResponse, provenance: LogProvenance | undefined, how: CheckedSave): Promise<DailyLog[] | null> => {
        const recording = how.recording;
        const typed = recording?.typed === true;
        try {
            // Lane OF fix 1 (L4): a recording that cannot be named or linked leaves a trace; the save still happens.
            const voiceClipId = recording && !typed ? await archiveIdOf(recording).catch((error: unknown) => { logger.warn('checked save: the archive id of the recording could not be read', { error: String(error) }); return undefined; }) : undefined;
            // A plot Sathi only suggested is never where it lands: the place he chose is (CTX-1).
            const { suggestedContext: _suggested, ...chosen } = draft;
            return await handleAutoSave(chosen as AgriLogResponse, provenance, {
                autoSavedFromVoice: true,
                ...(typed && { typedEntry: true }),
                ...(voiceClipId && { voiceClipId }),
                scope: how.scope,
                ...(how.dateKey && { dateKey: how.dateKey }),
                ...(how.stayOnScreen && { stayOnScreen: true }),
                ...(how.onceKey && { onceKey: how.onceKey }),
                onWritten: async (logs) => {
                    const primary = primaryLogOf(logs);
                    const clipId = primary && recording && !typed ? await linkClip(recording, primary.id).catch((error: unknown) => { logger.warn('checked save: the recording could not be linked to its log', { error: String(error) }); return null; }) : null;
                    if (how.stayOnScreen) return;
                    const unclear = (draft.unclearSegments ?? []).map(s => s.rawText?.trim() ?? '').filter(t => t.length > 0);
                    setVoiceResult({ logIds: logs.map(l => l.id), clipId, key: recording ? recordingKey(recording) : `checked|${Date.now()}`, unclear, written: logs, ...(typed && { typed: true }) });
                },
            });
        } catch (error) {
            logger.error('Checked voice save failed', error);
            return null;
        }
    }, [handleAutoSave, linkClip, archiveIdOf]);

    const clearVoiceResult = useCallback(() => setVoiceResult(null), []);

    return { sink, voiceResult, clearVoiceResult, saveChecked };
}
