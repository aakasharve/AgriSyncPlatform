/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - in Marathi mode a number the app
 * prints is shown in Devanagari digits (०-९); English mode keeps 0-9.
 *
 * Display only. These functions turn the DIGITS of a piece of text and touch nothing else: not a letter, not a separator, not a
 * sign. They never round, parse, truncate or compute, so a value that is stored, sent or compared is never run through them (P4).
 * The two older helpers (`toMarathiDigits` in labour/marathiDate, `toMarathiNumber` in logs/disciplineRecognition) take a whole
 * number only (the second drops a fraction) and live inside a feature; a recorded quantity ("1.5 किलो") and a ready-made line need
 * a helper that works on text, so this is the shared one.
 *
 * Odd input, as it behaves today and is pinned by a test (callers are not changed for it): `toDevanagariDigits(NaN)` is "NaN" (there is no
 * digit in the word, so it comes back as the word) and `toDevanagariDigits(undefined)` is "undefined" (it is `String(value)` first). Callers
 * pass a number that was recorded; a missing value is checked before, never run through this function.
 */

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** "5 दिवस उशीर" -> "५ दिवस उशीर"; "1.5" -> "१.५"; text with no digit comes back unchanged. */
export function toDevanagariDigits(value: string | number): string {
    return String(value).replace(/[0-9]/g, d => DEVANAGARI_DIGITS[Number(d)]);
}

/**
 * The digits in the screen's language: English keeps 0-9, every other language (Marathi; Hindi is not offered) reads Marathi - the
 * same split `resultCopy` uses for the result screen.
 */
export function digitsFor(value: string | number, language: string | null | undefined): string {
    return language === 'en' ? String(value) : toDevanagariDigits(value);
}
