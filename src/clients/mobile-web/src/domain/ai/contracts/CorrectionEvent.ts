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

export interface CorrectionEvent {
    id: string;
    extractionId: string;          // Links to EnhancedLogProvenance.extractionId
    timestamp: string;

    // What changed
    fieldPath: string;             // e.g., 'irrigation[0].durationHours', 'labour[0].maleCount'
    aiValue: unknown;              // What AI suggested
    userValue: unknown;            // What user corrected to

    // Context
    sourceText?: string;           // The transcript chunk that produced this field
    rawTranscript: string;         // Full transcript for this extraction
    promptVersion: string;

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
