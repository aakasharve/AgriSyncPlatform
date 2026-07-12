import { describe, it, expect } from 'vitest';
import {
    DFES_QUESTION_BANK, BANK_VERSION, QUESTION_ENGINE_VERSION, findGapQuestion,
} from '../dfesQuestionBank';

describe('DFES question bank v1 (Phase 5)', () => {
    it('every bank entry passes the hard AgronomistApproved && MarathiApproved gate', () => {
        for (const q of DFES_QUESTION_BANK) {
            expect(q.agronomistApproved, `${q.questionKey} agronomistApproved`).toBe(true);
            expect(q.marathiApproved, `${q.questionKey} marathiApproved`).toBe(true);
        }
    });

    it('stamps a stable BANK_VERSION and QUESTION_ENGINE_VERSION', () => {
        expect(BANK_VERSION).toBe('dfes-bank-1');
        expect(QUESTION_ENGINE_VERSION).toBe('dfes-qengine-1');
    });

    it('has one approved gap entry keyed gap.<dim> for all 8 scoring dimensions', () => {
        for (const dim of ['WHAT', 'DOSE', 'SCOPE', 'CARRIER', 'COST', 'PURPOSE', 'WEATHER', 'CONTINUITY']) {
            const q = findGapQuestion(dim);
            expect(q, `gap.${dim}`).toBeDefined();
            expect(q!.questionKey).toBe(`gap.${dim.toLowerCase()}`);
        }
    });

    it('re-buckets gap lenses per the locked 3-lens map', () => {
        expect(findGapQuestion('DOSE')!.lens).toBe('Execution');
        expect(findGapQuestion('PURPOSE')!.lens).toBe('Insight');
        expect(findGapQuestion('WEATHER')!.lens).toBe('Insight');
        expect(findGapQuestion('CONTINUITY')!.lens).toBe('Learning');
    });

    it('has no duplicate questionKeys', () => {
        const keys = DFES_QUESTION_BANK.map(q => q.questionKey);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('assigns a valid 1..6 priority and a 1..4 depthLevel to every entry', () => {
        for (const q of DFES_QUESTION_BANK) {
            expect(q.priority).toBeGreaterThanOrEqual(1);
            expect(q.priority).toBeLessThanOrEqual(6);
            expect(q.depthLevel).toBeGreaterThanOrEqual(1);
            expect(q.depthLevel).toBeLessThanOrEqual(4);
        }
    });
});
