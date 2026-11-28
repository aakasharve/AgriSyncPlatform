/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (part 03, B6; the founder's final design, 28 Nov) — "If the number of words are bigger, the waiting period is bigger":
 * 3 s + 0.17 s a word, never under 5 s, never over 20 s.
 */
import { describe, expect, it } from 'vitest';
import { MOVE_NOTE_MS, READ_BASE_MS, READ_MAX_MS, READ_MIN_MS, READ_PER_WORD_MS, readingTimeMs, wordCount } from '../readingTime';

describe('readingTime', () => {
    it('keeps the founder\'s numbers', () => {
        expect([READ_BASE_MS, READ_PER_WORD_MS, READ_MIN_MS, READ_MAX_MS, MOVE_NOTE_MS]).toEqual([3000, 170, 5000, 20000, 2400]);
    });

    it('3 s + 0.17 s a word between the limits', () => {
        expect(readingTimeMs(20)).toBe(6400);
        expect(readingTimeMs(50)).toBe(11_500);
        expect(readingTimeMs(99)).toBe(19_830);
    });

    it('never under 5 s: no words, few words, and the exact edge', () => {
        expect(readingTimeMs(0)).toBe(5000);
        expect(readingTimeMs(4)).toBe(5000);          // 3680 ms → 5 s
        expect(readingTimeMs(11)).toBe(5000);         // 4870 ms → 5 s
        expect(readingTimeMs(12)).toBe(5040);         // the first count over the floor
    });

    it('never over 20 s: the exact edge and a very long talk', () => {
        expect(readingTimeMs(100)).toBe(20_000);      // 20000 ms exactly
        expect(readingTimeMs(101)).toBe(20_000);      // 20170 ms → 20 s
        expect(readingTimeMs(5000)).toBe(20_000);
    });

    it('a count that is not a real count waits the least', () => {
        expect(readingTimeMs(-3)).toBe(5000);
        expect(readingTimeMs(Number.NaN)).toBe(5000);
        expect(readingTimeMs(20.9)).toBe(6400);
    });

    it('counts the words of his talk, split on any spaces', () => {
        expect(wordCount('दोन तास पाणी दिलं')).toBe(4);
        expect(wordCount('  आज   पाच मजूर\nहोते,  चार तास फवारणी केली  ')).toBe(8);
        expect(wordCount('')).toBe(0);
        expect(wordCount('   ')).toBe(0);
        expect(wordCount(undefined)).toBe(0);
        expect(readingTimeMs(wordCount('आज टोमॅटोच्या प्लॉटला फवारणी केली.'))).toBe(5000);
    });
});
