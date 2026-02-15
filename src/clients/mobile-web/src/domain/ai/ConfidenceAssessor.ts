/**
 * ConfidenceAssessor — DFES V2
 *
 * Pure domain service that assesses per-field confidence from AI response data.
 * Takes the optional `fieldConfidences` map from the AI response and
 * normalizes it into a typed FieldConfidenceMap with proper levels.
 *
 * ~80 lines. No side effects. No imports from infrastructure or UI.
 */

import {
    type FieldConfidence,
    type FieldConfidenceMap,
    type SuggestedAction,
    ConfidencePolicy,
} from './contracts/FieldConfidence';

/**
 * Result of confidence assessment for a parsed AI response.
 */
export interface ConfidenceAssessment {
    fieldConfidences: FieldConfidenceMap;
    suggestedAction: SuggestedAction;
    averageScore: number;
    hasLowConfidenceFields: boolean;
    lowConfidenceFields: string[];
}

/**
 * Assess confidence levels for an AI-parsed response.
 *
 * If the AI response includes a `confidence` map (field → score 0-1),
 * this converts it to typed FieldConfidence objects with levels.
 * If no confidence data is present, defaults to manual_review.
 */
export function assessConfidence(
    response: { confidence?: Record<string, number> },
    aiConfidences?: Record<string, number>
): ConfidenceAssessment {
    const fieldConfidences: FieldConfidenceMap = {};

    // Use AI-provided confidence scores if available
    const scores = aiConfidences ?? response.confidence ?? {};

    for (const [field, score] of Object.entries(scores)) {
        if (typeof score !== 'number' || score < 0 || score > 1) continue;
        const level = ConfidencePolicy.levelFromScore(score);
        fieldConfidences[field] = { level, score };
    }

    // If no confidence data at all, indicate manual review needed
    if (Object.keys(fieldConfidences).length === 0) {
        return {
            fieldConfidences: {},
            suggestedAction: 'manual_review',
            averageScore: 0,
            hasLowConfidenceFields: false,
            lowConfidenceFields: [],
        };
    }

    const suggestedAction = ConfidencePolicy.suggestAction(fieldConfidences);
    const averageScore = ConfidencePolicy.averageScore(fieldConfidences);
    const lowConfidenceFields = Object.entries(fieldConfidences)
        .filter(([, c]) => c.level === 'LOW')
        .map(([field]) => field);

    return {
        fieldConfidences,
        suggestedAction,
        averageScore,
        hasLowConfidenceFields: lowConfidenceFields.length > 0,
        lowConfidenceFields,
    };
}
