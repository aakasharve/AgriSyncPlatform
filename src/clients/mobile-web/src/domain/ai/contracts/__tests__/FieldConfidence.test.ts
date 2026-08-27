/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression cover for the confidence-level normalizer.
 *
 * BUGFIX_2026-07-19: `normalizeConfidenceLevel` typed its input as `string`
 * and called `.trim()` unguarded. The backend serializes
 * ShramSafal.Domain.AI.ConfidenceScore as a NUMBER (no JsonStringEnumConverter
 * is registered), so real responses crashed the log view with
 * "level.trim is not a function". It stayed hidden while AI responses were
 * coming back empty — no entries meant the loop never ran — and surfaced the
 * moment parsing actually produced field confidences.
 */
import { describe, it, expect } from 'vitest';
import { annotateFieldConfidencesWithBuckets } from '../FieldConfidence';

describe('annotateFieldConfidencesWithBuckets — level normalization', () => {
    it('maps backend enum ordinals (High=0, Medium=1, Low=2) to labels', () => {
        const annotated = annotateFieldConfidencesWithBuckets({
            'inputs.productName': { level: 0, score: 0.95 },
            'inputs.dose': { level: 1, score: 0.6 },
            'cropActivities.detectedCrop': { level: 2, score: 0.2 },
        });

        expect(annotated['inputs.productName'].level).toBe('HIGH');
        expect(annotated['inputs.dose'].level).toBe('MEDIUM');
        expect(annotated['cropActivities.detectedCrop'].level).toBe('LOW');
    });

    it('still accepts string labels, case- and whitespace-insensitively', () => {
        const annotated = annotateFieldConfidencesWithBuckets({
            a: { level: 'high', score: 0.9 },
            b: { level: '  Low  ', score: 0.1 },
        });

        expect(annotated.a.level).toBe('HIGH');
        expect(annotated.b.level).toBe('LOW');
    });

    it('degrades unknown shapes to MEDIUM instead of throwing', () => {
        // The whole point: a bad confidence label must never take down the
        // farmer's log view.
        const annotated = annotateFieldConfidencesWithBuckets({
            a: { level: null as unknown as string, score: 0.5 },
            b: { level: undefined as unknown as string, score: 0.5 },
            c: { level: {} as unknown as string, score: 0.5 },
            d: { level: 99, score: 0.5 },
            e: { level: 'NONSENSE', score: 0.5 },
        });

        for (const key of ['a', 'b', 'c', 'd', 'e']) {
            expect(annotated[key].level).toBe('MEDIUM');
        }
    });

    it('preserves score and reason while normalizing level', () => {
        const annotated = annotateFieldConfidencesWithBuckets({
            'inputs.dose': { level: 2, score: 0.31, reason: 'unclear audio' },
        });

        expect(annotated['inputs.dose'].score).toBe(0.31);
        expect(annotated['inputs.dose'].reason).toBe('unclear audio');
        expect(annotated['inputs.dose'].level).toBe('LOW');
    });
});
