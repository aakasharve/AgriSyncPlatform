/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VisibleBucketId } from '../BucketId';
import { inferVisibleBucketIdFromFieldPath } from '../BucketId';

export type CorrectionType =
    | 'wrong_value'        // AI extracted a value, user changed it (e.g., 3 hours -> 2 hours)
    | 'wrong_category'     // AI put it in wrong bucket (e.g., irrigation when it was spray input)
    | 'missing_field'      // AI missed extracting something user added
    | 'hallucinated_field' // AI invented a field that user removed
    | 'wrong_entity'       // AI picked wrong plot/crop/chemical
    | 'vocab_mapping'      // User taught a new word mapping
    // DATA_PRINCIPLE_SPINE sub-phase 10.6 (OQ-9) — third-party PII
    // redaction event. Emitted when the heuristic detector replaces
    // worker-name tokens with positional [WORKER_N] markers. The
    // bucket router (`withCorrectionBucket`) sends these to their own
    // bucket so the Phase 11 retraining reader filters via
    // `WHERE correctionType !== 'pii_redaction'`.
    | 'pii_redaction'
    | 'other';

/**
 * A single AI-vs-farmer disagreement, kept so the model can be taught.
 *
 * §P0.4 — **this type carries no verbatim speech.** `rawTranscript` (the whole
 * utterance) and `sourceText` ("the transcript chunk that produced this field")
 * were both removed: worker names live in exactly those chunks, and these rows
 * sit unencrypted in IndexedDB. What is kept is the structured signal — which
 * field, what the AI said, what the farmer said instead, and enough lineage to
 * identify the parse that produced it. `aiValue`/`userValue` are passed through
 * `stripTranscriptText` before they are stored, so speech cannot ride in nested.
 */
export interface CorrectionEvent {
    id: string;
    extractionId: string;          // Links to EnhancedLogProvenance.extractionId
    timestamp: string;

    // What changed
    fieldPath: string;             // e.g., 'irrigation[0].durationHours', 'labour[0].maleCount'
    aiValue: unknown;              // What AI suggested — transcript-stripped
    userValue: unknown;            // What user corrected to — transcript-stripped

    // Lineage — how to find the parse this correction is about, without
    // keeping a copy of what was said.
    /** Backend `AiJob.Id` (UUID) when the parse came from one. */
    sourceAiJobId?: string;
    /** Spine-honest model identifier, e.g. `"gemini-2.5-flash"`. */
    modelVersion?: string;
    promptVersion: string;
    /** 64-char SHA-256 hex of the prompt content — tamper-evident prompt id. */
    promptContentHash?: string;

    // Classification
    correctionType: CorrectionType;
    bucketId?: VisibleBucketId;
}

export function withCorrectionBucket(event: CorrectionEvent): CorrectionEvent {
    // DATA_PRINCIPLE_SPINE sub-phase 10.6 (OQ-9) — `pii_redaction`
    // events MUST NOT inherit a visible-bucket id. The retraining
    // reader (Phase 11) filters them out wholesale via the
    // correctionType predicate; if we attached a bucketId they would
    // be miscounted into the labour/observations/etc bucket-level
    // correction-rate signals. Leaving bucketId undefined here is
    // the "own bucket" semantics per OQ-9 — the absence of a
    // visible bucket id IS the marker.
    if (event.correctionType === 'pii_redaction') {
        return { ...event, bucketId: undefined };
    }
    return {
        ...event,
        bucketId: event.bucketId ?? inferVisibleBucketIdFromFieldPath(event.fieldPath),
    };
}
