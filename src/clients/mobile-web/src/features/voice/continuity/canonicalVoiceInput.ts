import type { LogScope } from '../../../domain/types/log.types';

/** The single envelope every ladder level + the re-interpret queue share. */
export interface CanonicalVoiceInput {
    /** Stable across ladder levels AND re-interpretation. */
    captureId: string;
    farmId: string;
    logScope: LogScope;
    /** ISO-8601 UTC recording instant (for "आज"/"काल" resolution). */
    recordedAtUtc: string;
    audioBase64: string | null;
    audioMimeType: string | null;
    /** Kept in-memory for the online attempt; persisted separately for pending. */
    audioBlob: Blob | null;
    /** Present once ANY ASR stage (Sarvam or device) yields text. */
    transcript: string | null;
    deviceAsrUsed: boolean;
}

export interface BuildCanonicalVoiceInputArgs {
    captureId?: string;
    farmId: string;
    logScope: LogScope;
    recordedAtUtc: string;
    audioBase64?: string | null;
    audioMimeType?: string | null;
    audioBlob?: Blob | null;
    transcript?: string | null;
    deviceAsrUsed?: boolean;
}

const newCaptureId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `cap-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

export function buildCanonicalVoiceInput(args: BuildCanonicalVoiceInputArgs): CanonicalVoiceInput {
    return {
        captureId: args.captureId ?? newCaptureId(),
        farmId: args.farmId,
        logScope: args.logScope,
        recordedAtUtc: args.recordedAtUtc,
        audioBase64: args.audioBase64 ?? null,
        audioMimeType: args.audioMimeType ?? null,
        audioBlob: args.audioBlob ?? null,
        transcript: args.transcript ?? null,
        deviceAsrUsed: args.deviceAsrUsed ?? false,
    };
}
