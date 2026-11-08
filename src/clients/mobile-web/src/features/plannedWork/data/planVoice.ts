/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2, fix round 1 P001 + P002; founder TAP-1, R15) - what he SAID on the plan
 * form, understood by THE SAME voice parse the installed log uses: the batch audio path (`useVoiceRecorder` `runBatchAudioPath` ->
 * `BackendAiClient.parseInput` with the audio -> `submitVoiceAudioInput` -> `POST /shramsafal/ai/voice-parse`), no prompt change. The first
 * `plannedTasks` item fills the work and the "when" cue; with none, the words the result carries fill the work box.
 *
 * (The streaming parse is switched off in the installed app - `useStreamingParse: false` - and its transcribe call needs a farm id the
 * consumer never sends, so this form does not use it.)
 *
 * What the path itself does, accepted as its own: the server writes an AI job row (and its attempt), keeps the raw audio in its cold tier,
 * keeps a transcript row, and the phone keeps its 30-day processing clip. The TASK carries no voice reference (R15): nothing of the voice
 * is copied into it.
 *
 * It is never kept as a pending voice job: the parse is asked only while the phone is online, AND the offline queue is closed for the
 * duration of the call (`setOfflineVoiceQueueGate`, the RF2 correction precedent), so a net lost mid-call answers "not kept" and nothing
 * becomes a log draft later. The gate is put back the way the app's composition root sets it (`mayKeepOffline`) in a `finally`; calls
 * overlapping each other close it once and open it when the last one ends.
 */
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import type { VoiceParserPort } from '../../../application/ports';
import { BackendAiClient } from '../../../infrastructure/ai/BackendAiClient';
import { OFFLINE_DAY_REFUSED_MESSAGE, OFFLINE_NOT_KEPT_MESSAGE, OFFLINE_SAVED_MESSAGE, setOfflineVoiceQueueGate } from '../../../infrastructure/ai/offlineVoiceQueue';
import { mayKeepOffline } from '../../../core/speak/speakFlow';

export interface PlanSpeech {
    /** What he said, as words (the result's transcript; the first item's title when the result carries none). */
    transcript: string;
    /** The first planned task's title, or his own words when the parse found none. */
    title: string;
    /** The first planned task's spoken "when" ("उद्या", "३ दिवसांनी"), when it had one. */
    dueHint: string | null;
}

export type PlanSpeechResult =
    | { ok: true; speech: PlanSpeech }
    | { ok: false; reason: 'offline' | 'failed' };

export interface PlanVoiceDeps {
    parser?: Pick<VoiceParserPort, 'parseInput'>;
    crops: CropProfile[];
    profile: FarmerProfile;
}

/** The planning parse reads no place: it is asked with an empty scope; the form asks "कुठे" itself (CTX-1). */
const NO_SCOPE: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };

let sharedParser: BackendAiClient | null = null;
const defaultParser = (): BackendAiClient => (sharedParser ??= new BackendAiClient());

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

const NOT_KEPT = new Set([OFFLINE_NOT_KEPT_MESSAGE, OFFLINE_SAVED_MESSAGE, OFFLINE_DAY_REFUSED_MESSAGE]);

/** How many plan calls hold the offline queue closed right now. */
let closers = 0;
async function withOfflineQueueClosed<T>(run: () => Promise<T>): Promise<T> {
    closers += 1;
    setOfflineVoiceQueueGate(() => false);
    try {
        return await run();
    } finally {
        closers -= 1;
        if (closers === 0) setOfflineVoiceQueueGate(mayKeepOffline);
    }
}

export async function understandPlanSpeech(audio: AudioData, deps: PlanVoiceDeps): Promise<PlanSpeechResult> {
    if (isOffline()) return { ok: false, reason: 'offline' };
    const parser = deps.parser ?? defaultParser();
    try {
        const result = await withOfflineQueueClosed(() => parser.parseInput(
            {
                type: 'audio',
                data: audio.base64,
                mimeType: audio.mimeType,
                recordedAtUtc: audio.recordedAtUtc,
                ...(audio.durationMs !== undefined ? { inputSpeechDurationMs: audio.durationMs, inputRawDurationMs: audio.durationMs } : {}),
            },
            NO_SCOPE, deps.crops, deps.profile,
        ));
        if (!result.success || !result.data) {
            return { ok: false, reason: (result.error && NOT_KEPT.has(result.error)) || isOffline() ? 'offline' : 'failed' };
        }
        const task = result.data.plannedTasks?.find(t => typeof t?.title === 'string' && t.title.trim().length > 0);
        const words = (result.rawTranscript ?? result.data.fullTranscript ?? '').trim();
        const title = task?.title.trim() ?? words;
        if (!title) return { ok: false, reason: 'failed' };
        return { ok: true, speech: { transcript: words || title, title, dueHint: task?.dueHint?.trim() || null } };
    } catch {
        return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
    }
}
