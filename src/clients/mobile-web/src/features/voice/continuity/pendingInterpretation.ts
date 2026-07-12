export type PendingInterpretationStatus = 'pending' | 'interpreting' | 'resolved' | 'failed';

/** The degraded ladder levels that produce a durable pending capture. */
export type PendingLadderLevel = 'transcript-only' | 'audio-only';

/** Dexie row shape (also the domain record — no separate mapping needed). */
export interface PendingInterpretationRecord {
    /** captureId — primary key, shared with CanonicalVoiceInput. */
    captureId: string;
    farmId: string;
    /** epoch ms — FIFO drain index. */
    createdAtUtc: number;
    status: PendingInterpretationStatus;
    ladderLevel: PendingLadderLevel;
    transcript: string | null;
    audioBase64: string | null;
    audioMimeType: string | null;
    /** Serialized LogScope (JSON) — round-tripped on drain. */
    logScopeJson: string;
    recordedAtUtc: string;
    attempts: number;
    lastAttemptAtUtc: number | null;
}
