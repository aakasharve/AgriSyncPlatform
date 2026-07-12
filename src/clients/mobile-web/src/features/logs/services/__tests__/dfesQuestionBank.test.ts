import { describe, it, expect } from 'vitest';
import {
    DFES_QUESTION_BANK, BANK_VERSION, QUESTION_ENGINE_VERSION, findGapQuestion, findQuestion,
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

    // Coordinator directive (task-36 SPECIAL NOTE): real agronomist/Marathi review
    // is a separate pre-pilot process — this bank is the CODE-REVIEWED artifact
    // that process feeds into, so every entry that lands here is already gated
    // true/true (see the first test above). This test proves the corollary: an
    // unapproved question has no way to be found/selected via this module's public
    // API, because findQuestion/findGapQuestion only ever search within
    // DFES_QUESTION_BANK — an array that can contain zero unapproved rows. The
    // engine (Phase 5 Task 5.4, dfesQuestionEngine.ts) adds a second, independent
    // `approved()` filter as defense-in-depth on top of this bank-level guarantee.
    it('an unapproved question is never selectable via findQuestion/findGapQuestion (hard gate proof)', () => {
        const unapprovedEntries = DFES_QUESTION_BANK.filter(
            q => !(q.agronomistApproved && q.marathiApproved),
        );
        expect(unapprovedEntries).toHaveLength(0);

        for (const q of DFES_QUESTION_BANK) {
            const byKey = findQuestion(q.questionKey);
            expect(byKey?.agronomistApproved).toBe(true);
            expect(byKey?.marathiApproved).toBe(true);
        }

        expect(findQuestion('does.not.exist')).toBeUndefined();
        expect(findGapQuestion('NOT_A_DIMENSION')).toBeUndefined();
    });
});
