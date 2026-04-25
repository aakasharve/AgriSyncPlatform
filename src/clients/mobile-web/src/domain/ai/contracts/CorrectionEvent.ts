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
    return {
        ...event,
        bucketId: event.bucketId ?? inferVisibleBucketIdFromFieldPath(event.fieldPath),
    };
}
