/**
 * FieldConfidence — DFES V2 Voice Safety Layer
 *
 * Per-field confidence scoring for AI-parsed log data.
 * Drives the auto-save gate: high-confidence → auto-confirm, low → manual review.
 *
 * Layer: Domain (pure types, no imports from UI/infrastructure)
 */

// =============================================================================
// CONFIDENCE TYPES
// =============================================================================

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface FieldConfidence {
    level: ConfidenceLevel;
    score: number;       // 0.0 - 1.0
    reason?: string;     // Why the confidence is what it is (e.g., "ambiguous crop name")
}

/**
 * Map of field name → confidence assessment.
 * Field names match AgriLogResponse keys (e.g., "cropActivities", "irrigation", etc.)
 * plus dot-notation for nested fields (e.g., "cropActivities[0].title").
 */
export type FieldConfidenceMap = Record<string, FieldConfidence>;

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

