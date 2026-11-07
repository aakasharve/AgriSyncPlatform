/**
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 4) — the fixed words for the
 * identity and mixing screens. Language strict (Marathi mode = Marathi only), no "AI" wording, no
 * emoji, never "मार्गदर्शिका" (founder 2026-11-06), never "तुम्ही" (real names only), and the photo
 * state never claims the packet will fill anything in (doctrine P5).
 */
import { describe, it, expect } from 'vitest';
import { INPUT_WORD_KEYS, inputWords } from '../inputWords';

const mr = inputWords('mr');
const en = inputWords('en');

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{200D}/u;

describe('inputWords', () => {
    it('has every key in both languages, non-empty', () => {
        expect(INPUT_WORD_KEYS).toHaveLength(19);
        for (const k of INPUT_WORD_KEYS) {
            expect(mr[k]?.trim().length, k).toBeGreaterThan(0);
            expect(en[k]?.trim().length, k).toBeGreaterThan(0);
        }
        expect(Object.keys(mr).sort()).toEqual([...INPUT_WORD_KEYS].sort());
        expect(Object.keys(en).sort()).toEqual([...INPUT_WORD_KEYS].sort());
    });

    it('English has no Devanagari; Marathi has no Latin letters', () => {
        for (const k of INPUT_WORD_KEYS) {
            expect(/[ऀ-ॿ]/.test(en[k]), k).toBe(false);
            expect(/[A-Za-z]/.test(mr[k]), k).toBe(false);
        }
    });

    it('nothing says AI, the guide, "तुम्ही", or carries an emoji', () => {
        for (const words of [mr, en]) {
            for (const k of INPUT_WORD_KEYS) {
                const s = words[k];
                expect(/\bAI\b/i.test(s), k).toBe(false);
                expect(s.includes('एआय'), k).toBe(false);
                expect(s.includes('मार्गदर्शिका'), k).toBe(false);
                expect(s.includes('तुम्ही'), k).toBe(false);
                expect(EMOJI.test(s), k).toBe(false);
            }
        }
    });

    it('photoKept is "फोटो ठेवला" and never promises the packet fills anything (P5)', () => {
        expect(mr.photoKept).toBe('फोटो ठेवला');
        expect(mr.photoKept.includes('पॅकेटवरून')).toBe(false);
        expect(en.photoKept).toBe('Photo saved');
    });

    it('fromLibrary names the ShramSafal Library', () => {
        expect(mr.fromLibrary).toBe('माहिती: श्रमसफल लायब्ररी');
        expect(en.fromLibrary).toBe('Source: ShramSafal Library');
    });

    it('ingredientNotInLibrary is the line for a brand-only product (review B009)', () => {
        expect(mr.ingredientNotInLibrary).toBe('घटक श्रमसफल लायब्ररीत नाही');
        expect(en.ingredientNotInLibrary).toBe('Ingredient not in the ShramSafal Library');
    });

    it('returns a fresh copy each call (a caller cannot change the shared words)', () => {
        const a = inputWords('mr');
        (a as Record<string, string>).yes = 'x';
        expect(inputWords('mr').yes).toBe('हो');
    });
});
