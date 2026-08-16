/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesQuestionEngine.confidence.test.ts — wave-3.6, spec Ruling 4 (2026-08-15):
 * Sathi names the work only when he is sure of it.
 *
 * Below the threshold he must not repeat a guessed activity; he asks the neutral
 * question instead. There was no central confidence rule before this — the engine had
 * `parseConfidence` nowhere and `pack()` resolved one prompt regardless — so a
 * misheard "फवारणी" was echoed back to the farmer as fact.
 *
 * TWO FACTS BOUND THE THRESHOLD, and both are asserted below rather than left in a
 * comment. `NormalizeConfidence` defaults an ABSENT value to 0.75
 * (AiResponseNormalizer.cs:444), so a threshold at or below 0.75 would let a default
 * masquerade as a measurement. The orchestrator already rejects anything below 0.60,
 * so a threshold at or below 0.60 would be dead code.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.6)
 */
import { describe, it, expect } from 'vitest';
import {
    selectDailyQuestion,
    isWorkRecognitionConfident,
    WORK_ACKNOWLEDGEMENT_THRESHOLD,
    type DailyQuestionInputs,
} from '../dfesQuestionEngine';
import type { VlogScore } from '../../../../domain/types/log.types';

const scoreWithGap = (dim: string): VlogScore => ({
    score: 40, outcome: 'SCORED',
    dimensions: [{ dimension: dim, applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }],
});

const base = (o: Partial<DailyQuestionInputs> = {}): DailyQuestionInputs => ({
    crop: 'grapes',
    todayLocalDate: '2026-07-11',
    score: scoreWithGap('DOSE'),
    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
    recentEvents: [],
    ...o,
});

describe('Ruling 4 — Sathi names the work only when he is sure', () => {
    it('names the work when the parse was confident', () => {
        const picked = selectDailyQuestion(base({
            parseConfidence: 0.92, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
        }));
        expect(picked!.resolvedPromptMr).toContain('फवारणी');
    });

    it('never names a guessed activity when the parse was not confident', () => {
        const picked = selectDailyQuestion(base({
            parseConfidence: 0.65, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
        }));
        expect(picked!.resolvedPromptMr).not.toContain('फवारणी');
    });

    it('treats a manual entry (no confidence score) as confident, not as unsure', () => {
        // A manual entry carries NO confidence score at all. `undefined` means "no model
        // guessed anything", which is the most certain case there is — never the least.
        // Reading it as low would give every manual-entry farmer the unsure wording.
        const picked = selectDailyQuestion(base({
            parseConfidence: undefined, todayWork: { activityMr: 'छाटणी' }, score: scoreWithGap('COST'),
        }));
        expect(picked!.resolvedPromptMr).toContain('छाटणी');
    });

    it('asks the neutral question, not a subject-less sentence, when unsure', () => {
        // The variants are two SEPARATE strings, not one string with an optional token.
        // An absent token substitutes '' and tidyResolvedPrompt collapses the gap, so a
        // single-string design would hand an unsure farmer the confident sentence minus
        // its subject — which is worse than either variant.
        const unsure = selectDailyQuestion(base({
            parseConfidence: 0.65, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
        }));
        expect(unsure!.resolvedPromptMr).toBe('किती मात्रा (डोस) वापरली?');
    });

    it('never leaves a raw or empty brace in either variant', () => {
        for (const parseConfidence of [0.92, 0.65, undefined]) {
            const picked = selectDailyQuestion(base({
                parseConfidence, todayWork: { activityMr: 'फवारणी' }, score: scoreWithGap('DOSE'),
            }));
            expect(picked!.resolvedPromptMr).not.toMatch(/[{}]/);
        }
    });

    it('stays neutral when nothing at all was recognised, however confident the parse claims to be', () => {
        // P4 — a high confidence score about NO recognised work is not a licence to
        // invent a subject for the sentence.
        const picked = selectDailyQuestion(base({
            parseConfidence: 0.99, todayWork: undefined, score: scoreWithGap('DOSE'),
        }));
        expect(picked!.resolvedPromptMr).toBe('किती मात्रा (डोस) वापरली?');
    });
});

describe('isWorkRecognitionConfident — the single rule every question reads', () => {
    const inputs = (o: Partial<DailyQuestionInputs>) => base({ todayWork: { activityMr: 'फवारणी' }, ...o });

    it('sits ABOVE the 0.75 that NormalizeConfidence uses for an absent field', () => {
        // AiResponseNormalizer.cs:444 defaults a missing confidence to 0.75. If the
        // threshold were <= 0.75 a model that simply omitted the field would be treated
        // as having measured high confidence.
        expect(WORK_ACKNOWLEDGEMENT_THRESHOLD).toBeGreaterThan(0.75);
        expect(isWorkRecognitionConfident(inputs({ parseConfidence: 0.75 }))).toBe(false);
    });

    it('sits ABOVE the orchestrator 0.60 floor — a threshold at or below it is dead code', () => {
        expect(WORK_ACKNOWLEDGEMENT_THRESHOLD).toBeGreaterThan(0.60);
    });

    it('is inclusive at the threshold', () => {
        expect(isWorkRecognitionConfident(inputs({ parseConfidence: WORK_ACKNOWLEDGEMENT_THRESHOLD }))).toBe(true);
        expect(isWorkRecognitionConfident(inputs({ parseConfidence: WORK_ACKNOWLEDGEMENT_THRESHOLD - 0.01 }))).toBe(false);
    });

    it('is false whenever nothing was recognised, whatever the score says', () => {
        expect(isWorkRecognitionConfident(base({ todayWork: undefined, parseConfidence: 0.99 }))).toBe(false);
        expect(isWorkRecognitionConfident(base({ todayWork: undefined, parseConfidence: undefined }))).toBe(false);
    });
});
