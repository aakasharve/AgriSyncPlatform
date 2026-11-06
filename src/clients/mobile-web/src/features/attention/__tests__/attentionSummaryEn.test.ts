/**
 * spec: plr-d10 (I28, lane L4b fix round 0) — the strip's लक्ष द्या signal in English mode is the English twin of the
 * Marathi count line (same kinds, same order), never a bare "Attention N", and carries no Devanagari.
 */
import { describe, expect, it } from 'vitest';
import { attentionSummaryEn, attentionSummaryMr, type AttentionCounts } from '../attentionItems';

const counts = (over: Partial<AttentionCounts>): AttentionCounts => ({
    lateSteps: 0, lateReminders: 0, todaySteps: 0, todayReminders: 0, decisions: 0, ...over,
});

describe('attentionSummaryEn — the English twin of the strip\'s लक्ष द्या line', () => {
    it('names the same kinds in the same order as the Marathi line', () => {
        const c = counts({ lateSteps: 2, todayReminders: 1 });
        expect(attentionSummaryMr(c)).toBe('2 कामे उशिराची · 1 आठवण आज');
        expect(attentionSummaryEn(c)).toBe('2 tasks late · 1 reminder today');
    });

    it('says only the kinds that are there, singular and plural, in English only', () => {
        expect(attentionSummaryEn(counts({ lateReminders: 1, todaySteps: 3, decisions: 2 })))
            .toBe('1 reminder late · 3 tasks today · 2 decisions pending');
        expect(attentionSummaryEn(counts({}))).toBe('');
        expect(attentionSummaryEn(counts({ lateSteps: 1, decisions: 1 }))).not.toMatch(/[ऀ-ॿ]|Attention/);
    });
});
