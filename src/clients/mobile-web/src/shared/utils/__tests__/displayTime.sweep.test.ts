// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * THE GUARD FOR THE THIRTY-FIRST CALL SITE.
 *
 * Sixteen inline time formatters and three partial helpers were replaced by one
 * module. A sweep fixes what exists; it does nothing about the next `hour:
 * '2-digit'` somebody writes next month. This scans the source for any
 * user-facing clock that bypasses the shared formatter and fails naming it.
 *
 * IT EARNED ITS KEEP BEFORE IT WAS EVEN COMMITTED: writing it surfaced
 * `AiDraftsPage.tsx`, which my first grep had truncated past.
 *
 * NOT IN SCOPE, and deliberately not matched: stored values, wire formats, log
 * lines and machine-read strings. `DateKeyService` builds `HH:mm:ss` for ISO
 * timestamps and must keep doing so; elapsed durations (`mm:ss` on the audio
 * recorder and clip player) are not times of day.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** The one module allowed to construct a time formatter. */
const FORMATTER_HOME = join('shared', 'utils', 'displayTime.ts');

/**
 * Files exempt, each for a stated reason.
 *
 * `cropEmojis.ts` re-exports the helper and matches on the export name alone.
 */
const EXEMPT_SUBSTRINGS = [
    FORMATTER_HOME,
    join('shared', 'utils', 'cropEmojis.ts'),
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === '__mocks__' || entry === 'node_modules') continue;
            sourceFiles(full, acc);
        } else if (/\.tsx?$/.test(entry)) {
            acc.push(full);
        }
    }
    return acc;
}

const FILES = sourceFiles(SRC).filter(f => !EXEMPT_SUBSTRINGS.some(x => f.includes(x)));

function offenders(pattern: RegExp): string[] {
    const hits: string[] = [];
    for (const file of FILES) {
        const source = readFileSync(file, 'utf8');
        source.split(/\r?\n/).forEach((line, i) => {
            if (pattern.test(line)) {
                hits.push(`${file.replace(SRC, 'src')}:${i + 1}: ${line.trim().slice(0, 110)}`);
            }
        });
    }
    return hits;
}

describe('no user-facing clock bypasses the shared 12-hour formatter', () => {
    it('the scan found the source it is meant to read', () => {
        // Guards the whole file against passing vacuously on a wrong cwd.
        expect(FILES.length).toBeGreaterThan(300);
        expect(FILES.some(f => f.includes(join('features', 'weather')))).toBe(true);
    });

    it('nothing calls toLocaleTimeString outside the formatter', () => {
        expect(
            offenders(/\.toLocaleTimeString\s*\(/),
            'Use formatDisplayTime from shared/utils/displayTime — it pins IST and 12-hour '
            + 'AM/PM. A bare toLocaleTimeString follows the DEVICE locale and reads 24-hour on '
            + 'any handset set to it.',
        ).toEqual([]);
    });

    it('nothing formats an hour through toLocaleString outside the formatter', () => {
        expect(
            offenders(/\.toLocaleString\s*\([^)]*\bhour\b/),
            'Use formatDisplayDateTime from shared/utils/displayTime.',
        ).toEqual([]);
    });

    it('nothing constructs an Intl time formatter outside the formatter', () => {
        expect(
            offenders(/new Intl\.DateTimeFormat\s*\([^)]*\bhour\b/),
            'Use shared/utils/displayTime.',
        ).toEqual([]);
    });

    it('nothing asks for 24-hour output explicitly', () => {
        expect(
            offenders(/hour12\s*:\s*false/),
            'Founder decision 2026-08-16: user-facing times are 12-hour with AM and PM.',
        ).toEqual([]);
    });

    it('no en-GB or other 24-hour locale is used for a time', () => {
        // `WeatherWidget` shipped `en-GB` for its clock, which is 24-hour, while
        // using the same locale for its date — where it is fine. Only the time
        // half was wrong, which is why this matches the time call specifically.
        expect(
            offenders(/toLocaleTimeString\s*\(\s*['"]en-GB['"]/),
            'en-GB renders 24-hour clocks.',
        ).toEqual([]);
    });
});
