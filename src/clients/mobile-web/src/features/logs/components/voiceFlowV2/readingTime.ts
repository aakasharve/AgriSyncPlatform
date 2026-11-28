/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B6; the founder's final design, 28 Nov) — how long the result screen
 * waits, untouched, before it moves to पूर्ण शेतीचा आढावा by itself. The founder's words: "If the number of words are bigger, the
 * waiting period is bigger". The design's rule: 3 s plus 0.17 s for each word of his talk shown on the result, never under 5 s and
 * never over 20 s. Pure.
 */

export const READ_BASE_MS = 3000;
export const READ_PER_WORD_MS = 170;
export const READ_MIN_MS = 5000;
export const READ_MAX_MS = 20000;
/** The short note "आजच्या शेतीचा आढावा बघा" stays this long before the move (the design's 2.4 s). */
export const MOVE_NOTE_MS = 2400;

/** The words in what is shown (split on spaces; an empty or missing text has none). */
export function wordCount(text: string | null | undefined): number {
    const t = (text ?? '').trim();
    return t ? t.split(/\s+/).length : 0;
}

/** The wait for `words` words: 3 s + 0.17 s a word, held between 5 s and 20 s. */
export function readingTimeMs(words: number): number {
    const n = Number.isFinite(words) && words > 0 ? Math.floor(words) : 0;
    return Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, READ_BASE_MS + n * READ_PER_WORD_MS));
}
