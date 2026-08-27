import type { CanonicalVoiceInput } from './canonicalVoiceInput';
import type { PendingInterpretationRecord, PendingLadderLevel } from './pendingInterpretation';

export type ContinuityLevel = 'streaming' | 'batch' | 'transcript-only' | 'audio-only';

export interface LadderContext {
    online: boolean;
    /** True once the online pipeline produced a committed structured draft. */
    structuredParseSucceeded: boolean;
    /** Whether the successful structuring came from the SSE stream (vs batch). */
    usedStream: boolean;
    deviceAsrAvailable: boolean;
    /** Any transcript we managed to obtain (Sarvam or device ASR). */
    transcript: string | null;
}

/**
 * The 4-level voice-continuity ladder:
 *   L1 streaming        — online, structured via SSE stream.
 *   L2 batch            — online, structured via Gemini multimodal fallback.
 *   L3 transcript-only  — could not structure, but we HAVE the words → persist.
 *   L4 audio-only       — could not structure and have no words → persist audio.
 * L3/L4 preserve the streak: no aggregate is written, the day stays
 * UnaccountedDay (NEUTRAL per Phase-3 fold) until the capture is re-interpreted.
 */
export function decideLadderLevel(ctx: LadderContext): ContinuityLevel {
    if (ctx.structuredParseSucceeded) {
        return ctx.usedStream ? 'streaming' : 'batch';
    }
    const hasTranscript = !!(ctx.transcript && ctx.transcript.trim().length > 0);
    return hasTranscript ? 'transcript-only' : 'audio-only';
}

export function buildPendingFromCanonical(
    input: CanonicalVoiceInput,
    level: PendingLadderLevel,
    createdAtUtc: number,
): PendingInterpretationRecord {
    return {
        captureId: input.captureId,
        farmId: input.farmId,
        createdAtUtc,
        status: 'pending',
        ladderLevel: level,
        // transcript-only keeps the words and drops the audio;
        // audio-only keeps the audio and has no transcript.
        transcript: level === 'transcript-only' ? input.transcript : null,
        audioBase64: level === 'audio-only' ? input.audioBase64 : null,
        audioMimeType: level === 'audio-only' ? input.audioMimeType : null,
        logScopeJson: JSON.stringify(input.logScope),
        recordedAtUtc: input.recordedAtUtc,
        attempts: 0,
        lastAttemptAtUtc: null,
    };
}
