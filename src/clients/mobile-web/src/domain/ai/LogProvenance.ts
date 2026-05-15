/**
 * LogProvenance — frontend view of the AI/manual provenance recorded
 * against an AgriLog draft or persisted log.
 *
 * Existing fields preserved verbatim. New optional fields landed by
 * DATA_PRINCIPLE_SPINE sub-phase 01.6 — they mirror the backend
 * Provenance VO (ShramSafal.Domain.Common.Provenance) introduced in
 * sub-phase 01.1 and surface from the voice-parse response envelope
 * landed in 01.5. All optional so existing logs (pre-v16) keep
 * loading without runtime errors.
 *
 * Source widening: `'pre_spine'` is a frontend-local marker stamped
 * only by the Dexie v15 -> v16 backfill upgrade. It is never sent in
 * mutations — `BackendAiClient` continues to stamp `'ai'` on fresh
 * parses, and manual entries stay `'manual'`.
 */
export interface LogProvenance {
    source: 'manual' | 'ai' | 'pre_spine';
    model?: string;
    /**
     * Spine-honest model identifier (semver-ish label like
     * `"gemini-2.5-flash"`). Distinct from `model` which stays for
     * back-compat with pre-spine readers. New code should populate
     * both; readers may fall back to `model` when `modelVersion` is
     * absent.
     */
    modelVersion?: string;
    providerUsed?: string;
    fallbackUsed?: boolean;
    promptVersion?: string;
    /** 64-char SHA-256 hex of the prompt content used for the parse. */
    promptContentHash?: string;
    /** Client app version captured via `X-App-Version` at parse time. */
    appVersion?: string;
    /** UUID from backend `AiJob.Id` — links a log to its origin job. */
    sourceAiJobId?: string;
    /**
     * Reference to the raw input (audio/transcript) blob that produced
     * this provenance. `null` in Phase 01; Phase 02 populates with a
     * storage handle.
     */
    rawInputRef?: string | null;
    rawTranscript?: string;
    confidenceScore?: number;
    processingTimeMs?: number;
    timestamp: string;
    validation?: {
        stage: 'infrastructure_parser' | 'application_contract_gate';
        outcome: 'pass' | 'fail';
        issues?: string[];
    };
}
