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

// =============================================================================
// CONFIDENCE POLICY
// =============================================================================

/**
 * ConfidencePolicy — determines the suggested action from a confidence map.
 * Pure domain logic, no side effects.
 */
export class ConfidencePolicy {
    /**
     * Determine the overall confidence level from a score.
     */
    static levelFromScore(score: number): ConfidenceLevel {
        if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
        if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
        return 'LOW';
    }

    /**
     * Determine the suggested action from a field confidence map.
     */
    static suggestAction(confidences: FieldConfidenceMap): SuggestedAction {
        const entries = Object.entries(confidences);
        if (entries.length === 0) return 'manual_review';

        let hasLowCritical = false;
        let lowCount = 0;
        let mediumCount = 0;

        for (const [field, conf] of entries) {
            if (conf.level === 'LOW') {
                lowCount++;
                if (CRITICAL_FIELDS.has(field)) {
                    hasLowCritical = true;
                }
            } else if (conf.level === 'MEDIUM') {
                mediumCount++;
                // Critical fields at MEDIUM are also flagged
                if (CRITICAL_FIELDS.has(field) && conf.score < CONFIDENCE_THRESHOLDS.CRITICAL_FIELD_THRESHOLD) {
                    hasLowCritical = true;
                }
            }
        }

        // Any critical field uncertain → manual review
        if (hasLowCritical) return 'manual_review';

        // Multiple low-confidence fields → save as draft
        if (lowCount >= 3) return 'save_as_draft';

        // Some low or medium fields → review with highlights
        if (lowCount > 0 || mediumCount > 0) return 'review_flagged';

        // Everything HIGH → auto-confirm
        return 'auto_confirm';
    }

    /**
     * Compute average confidence score across all fields.
     */
    static averageScore(confidences: FieldConfidenceMap): number {
        const scores = Object.values(confidences).map(c => c.score);
        if (scores.length === 0) return 0;
        return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }
}
