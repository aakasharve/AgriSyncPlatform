/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 6; open point 9 (d); founder: Marathi mode Marathi only,
 * English mode English only, no emoji, no "AI" wording, P10) - every NEW word of the schedule gate, both languages, as data:
 *   - Marathi words hold no Latin letter (the digits are the app's Latin digits), English words no Devanagari letter;
 *   - no emoji, nothing says "AI";
 *   - both languages say the same things (same keys, a function in one is a function in the other);
 *   - every line is marked `// PROPOSED (Marathi)` / `// PROPOSED (English)` or comes from the plan's word list (read from the source);
 *   - the Marathi part names are the app's own four words (`PART_LABEL`), never a second copy that could drift.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCHEDULE_GATE_WORDS } from '../scheduleGateCopy';
import { PART_LABEL } from '../scheduleModel';

/** Every string the table says, with sample arguments for the lines that take some. */
const sayAll = (words: Record<string, unknown>): string[] => {
    const out: string[] = [];
    for (const value of Object.values(words)) {
        if (typeof value === 'string') out.push(value);
        else if (typeof value === 'function') out.push((value as (...a: unknown[]) => string)(7, 21));
        else if (value && typeof value === 'object') out.push(...sayAll(value as Record<string, unknown>));
    }
    return out;
};

describe('the schedule gate words', () => {
    const mr = sayAll(SCHEDULE_GATE_WORDS.mr as unknown as Record<string, unknown>);
    const en = sayAll(SCHEDULE_GATE_WORDS.en as unknown as Record<string, unknown>);

    it('Marathi_has_no_Latin_letter and English_has_no_Devanagari_letter', () => {
        // a function line is given a Marathi title where it takes one, so the scan reads the app's words only
        for (const line of mr) expect(line, line).not.toMatch(/[A-Za-z]/);
        for (const line of en) expect(line, line).not.toMatch(/[ऀ-ॿ]/);
    });

    it('No_emoji_and_no_AI_wording, in either language', () => {
        for (const line of [...mr, ...en]) {
            expect(line, line).not.toMatch(/\p{Extended_Pictographic}/u);
            expect(line, line).not.toMatch(/\bAI\b|\bA\.I\.|कृत्रिम बुद्धि/i);
        }
    });

    it('Both_languages_say_the_same_things: the same keys, and a function in one is a function in the other', () => {
        const kinds = (words: Record<string, unknown>): Record<string, string> =>
            Object.fromEntries(Object.entries(words).map(([k, v]) => [k, typeof v === 'object' ? `object:${Object.keys(v as object).join(',')}` : typeof v]));
        expect(kinds(SCHEDULE_GATE_WORDS.mr as unknown as Record<string, unknown>)).toEqual(kinds(SCHEDULE_GATE_WORDS.en as unknown as Record<string, unknown>));
    });

    it('The_Marathi_parts_are_the_apps_own_four_words (PART_LABEL), not a copy that can drift', () => {
        expect(SCHEDULE_GATE_WORDS.mr.parts).toEqual(PART_LABEL);
    });

    it('Every_line_is_marked: PROPOSED (Marathi) / PROPOSED (English), or taken from the plan\'s word list or the page\'s own phrasing', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const source = readFileSync(join(here, '..', 'scheduleGateCopy.ts'), 'utf8').split(/\r?\n/);
        const lines = source.filter(l => /^\s{8}[a-zA-Z]+:\s/.test(l) && !/^\s{8}(mr|en):/.test(l));
        expect(lines.length).toBeGreaterThan(40);
        for (const l of lines) {
            expect(l, l).toMatch(/\/\/ (PLAN WORD LIST|PROPOSED \((Marathi|English)\)|the app's|the page's|the app's four parts)/);
        }
    });
});
