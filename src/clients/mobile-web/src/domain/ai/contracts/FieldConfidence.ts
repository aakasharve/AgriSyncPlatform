/**
 * FieldConfidence — DFES V2 Voice Safety Layer
 *
 * Per-field confidence scoring for AI-parsed log data.
 * Drives the auto-save gate: high-confidence → auto-confirm, low → manual review.
 *
 * Layer: Domain (pure types — UI / infra imports are forbidden here)
 */

import type { VisibleBucketId } from '../BucketId';
import { inferVisibleBucketIdFromFieldPath } from '../BucketId';

// =============================================================================
// CONFIDENCE TYPES
// =============================================================================

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface FieldConfidence {
    level: ConfidenceLevel;
    score: number;       // 0.0 - 1.0
    reason?: string;     // Why the confidence is what it is (e.g., "ambiguous crop name")
    bucketId?: VisibleBucketId;
}

/**
 * Map of field name → confidence assessment.
 * Field names match AgriLogResponse keys (e.g., "cropActivities", "irrigation", etc.)
 * plus dot-notation for nested fields (e.g., "cropActivities[0].title").
 */
export type FieldConfidenceMap = Record<string, FieldConfidence>;

export type RawFieldConfidenceMap = Record<string, {
    /**
     * String label ('HIGH'|'MEDIUM'|'LOW') OR the backend enum ordinal
     * (0|1|2) — the API serializes ConfidenceScore numerically today, and
     * previously-stored Dexie logs hold the numeric form. Normalized by
     * annotateFieldConfidencesWithBuckets; never read this raw.
     */
    level: string | number;
    score: number;
    reason?: string;
    bucketId?: VisibleBucketId;
}>;

/**
 * Suggested action based on overall confidence assessment.
 */
export type SuggestedAction =
    | 'auto_confirm'      // All fields HIGH → save and confirm immediately
    | 'review_flagged'    // Some fields LOW → show form with amber highlights
    | 'manual_review'     // Multiple critical fields LOW → full manual form
    | 'save_as_draft';    // Overall too low → save transcript only as DRAFT

// =============================================================================
// THRESHOLDS
// =============================================================================

/**
 * Confidence thresholds for determining suggested actions.
 * Critical fields (plot, crop, chemical/pesticide) have higher thresholds.
 */
export const CONFIDENCE_THRESHOLDS = {
    /** Score at or above → HIGH */
    HIGH: 0.85,
    /** Score at or above → MEDIUM */
    MEDIUM: 0.50,
    /** Below MEDIUM → LOW */

    /** Critical fields require higher confidence for auto-confirm */
    CRITICAL_FIELD_THRESHOLD: 0.90,
} as const;

/**
 * Fields that are considered critical for safety.
 * These require CRITICAL_FIELD_THRESHOLD for auto-confirm.
 */
export const CRITICAL_FIELDS = new Set([
    'cropActivities.detectedCrop',
    'inputs.productName',
    'inputs.type',
    'inputs.dose',
    'targetPlotName',
]) as ReadonlySet<string>;

/**
 * Backend enum ordinals for ShramSafal.Domain.AI.ConfidenceScore.
 * The API has no JsonStringEnumConverter registered, so `level` arrives on the
 * wire as a NUMBER (High=0, Medium=1, Low=2) even though the contract types it
 * as a string. Logs already persisted in Dexie carry that numeric form too, so
 * this mapping stays regardless of what the server emits going forward.
 */
const CONFIDENCE_ORDINALS: Record<number, ConfidenceLevel> = {
    0: 'HIGH',
    1: 'MEDIUM',
    2: 'LOW',
};

/**
 * BUGFIX_2026-07-19: this took `level: string` and called `.trim()` on it
 * unguarded, so a numeric level crashed the whole render with
 * "level.trim is not a function". It stayed latent while AI responses were
 * coming back empty (no entries to iterate); once parsing actually worked and
 * real fieldConfidences arrived, every render hit it.
 *
 * Accepts unknown and degrades to MEDIUM rather than throwing — an
 * unrecognisable confidence label must never take down the log view.
 */
function normalizeConfidenceLevel(level: unknown): ConfidenceLevel {
    if (typeof level === 'number' && Number.isFinite(level)) {
        return CONFIDENCE_ORDINALS[level] ?? 'MEDIUM';
    }

    if (typeof level !== 'string') {
        return 'MEDIUM';
    }

    const normalized = level.trim().toUpperCase();
    if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') {
        return normalized;
    }

    return 'MEDIUM';
}

export function annotateFieldConfidencesWithBuckets(
    fieldConfidences: RawFieldConfidenceMap,
): FieldConfidenceMap {
    const annotated: FieldConfidenceMap = {};

    for (const [fieldPath, confidence] of Object.entries(fieldConfidences)) {
        annotated[fieldPath] = {
            ...confidence,
            level: normalizeConfidenceLevel(confidence.level),
            bucketId: confidence.bucketId ?? inferVisibleBucketIdFromFieldPath(fieldPath),
        };
    }

    return annotated;
}

