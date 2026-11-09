/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - the digit helper changes the script of a
 * number's digits and nothing else: no rounding, no truncation, no reading of the value.
 */
import { describe, expect, it } from 'vitest';
import { digitsFor, toDevanagariDigits } from '../marathiDigits';

describe('toDevanagariDigits', () => {
    it('turns every digit 0-9 into ०-९, in order', () => {
        expect(toDevanagariDigits('0123456789')).toBe('०१२३४५६७८९');
    });

    it('a number keeps its fraction, its sign and its separators (nothing is cut or rounded)', () => {
        expect(toDevanagariDigits(1250.5)).toBe('१२५०.५');
        expect(toDevanagariDigits(-3)).toBe('-३');
        expect(toDevanagariDigits('1,250.50')).toBe('१,२५०.५०');
        expect(toDevanagariDigits(0)).toBe('०');
    });

    it('text around the digits is untouched: letters, Devanagari words, times, grades, percentages', () => {
        expect(toDevanagariDigits('5 दिवस उशीर')).toBe('५ दिवस उशीर');
        expect(toDevanagariDigits('दुपारी 3:30')).toBe('दुपारी ३:३०');
        expect(toDevanagariDigits('19:19:19')).toBe('१९:१९:१९');
        expect(toDevanagariDigits('17.8%')).toBe('१७.८%');
        expect(toDevanagariDigits('₹400 प्रत्येकी')).toBe('₹४०० प्रत्येकी');
        expect(toDevanagariDigits('Confidor 250 ml')).toBe('Confidor २५० ml');
    });

    it('digits that are already Devanagari, and text with no digit, come back as they were', () => {
        expect(toDevanagariDigits('२५० मिली')).toBe('२५० मिली');
        expect(toDevanagariDigits('आज')).toBe('आज');
        expect(toDevanagariDigits('')).toBe('');
    });

    it('pins odd input as it behaves today: NaN comes back as the word "NaN", undefined as "undefined" (callers never pass them)', () => {
        expect(toDevanagariDigits(NaN)).toBe('NaN');
        expect(toDevanagariDigits(undefined as unknown as string)).toBe('undefined');
    });

    it('is its own fixed point (running it twice changes nothing more)', () => {
        const once = toDevanagariDigits('आज 12 वेळा, ₹1,200');
        expect(toDevanagariDigits(once)).toBe(once);
    });
});

describe('digitsFor', () => {
    it('English keeps 0-9', () => {
        expect(digitsFor(250, 'en')).toBe('250');
        expect(digitsFor('Told 2 times today', 'en')).toBe('Told 2 times today');
    });

    it('Marathi, and a language that is not set (the app reads Marathi), get Devanagari digits', () => {
        expect(digitsFor(250, 'mr')).toBe('२५०');
        expect(digitsFor(250, undefined)).toBe('२५०');
        expect(digitsFor(250, null)).toBe('२५०');
    });
});
