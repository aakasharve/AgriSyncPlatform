// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (twelve-hour-time-display)
 *
 * THE GUARD FOR THE NEXT CALL SITE — REWRITTEN AFTER IT PASSED GREEN OVER TWO.
 *
 * The first version of this file caught one real defect (`AiDraftsPage`) and was
 * then reported as evidence that the sweep was complete. It was not. It passed
 * green over `OfflineConflictPage.tsx:105` and `ReliabilityScoreCard.tsx:193`,
 * both live user-facing clocks, for three reasons that are all worth naming
 * because each is a way a scanner lies:
 *
 *   1. IT REQUIRED THE TOKEN `hour` INSIDE THE ARGUMENTS.
 *      `\.toLocaleString\s*\([^)]*\bhour\b` cannot see `toLocaleString()` — the
 *      form that renders a full date AND time BY DEFAULT, and the form both
 *      survivors used. The guard was looking for the option and missing the
 *      behaviour.
 *
 *   2. IT SCANNED LINE BY LINE.
 *      Any `toLocaleString(` or `Intl.DateTimeFormat(` whose `hour` sits on a
 *      later line escaped entirely. This file now matches across the whole
 *      source text and derives the line number from the match offset.
 *
 *   3. IT DID NOT KNOW ABOUT `timeStyle`.
 *      `{ timeStyle: 'short' }` is a time formatter with no `hour` token in it.
 *
 * The rule underneath, which is the point: A GUARD MUST MATCH THE BEHAVIOUR IT
 * FORBIDS, NOT ONE SPELLING OF IT. Matching an option name is matching a
 * spelling.
 *
 * NOT IN SCOPE, and deliberately not matched: stored values, wire formats, log
 * lines and machine-read strings. `DateKeyService` builds `HH:mm:ss` for ISO
 * timestamps and must keep doing so; elapsed durations (`mm:ss` on the audio
 * recorder and clip player) are not times of day; and `.toLocaleString()` on a
 * NUMBER is money formatting, of which this codebase has ~30 legitimate uses.
 * The patterns below therefore key on a DATE receiver or a date/time option,
 * never on the method name alone.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

/** The one module allowed to construct a time formatter. */
const FORMATTER_HOME = join('shared', 'utils', 'displayTime.ts');

/** `cropEmojis.ts` only re-exports the helper; it matches on the name alone. */
const EXEMPT_SUBSTRINGS = [FORMATTER_HOME, join('shared', 'utils', 'cropEmojis.ts')];

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

/**
 * Whole-file scan. Blind spot 2 was that this used to be per-line; the line
 * number is now derived from the match offset so multi-line calls are caught
 * and still reported precisely.
 */
function offenders(pattern: RegExp): string[] {
    const hits: string[] = [];
    for (const file of FILES) {
        const source = readFileSync(file, 'utf8');
        const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) !== null) {
            const line = source.slice(0, m.index).split('\n').length;
            hits.push(`${file.replace(SRC, 'src')}:${line}: ${m[0].replace(/\s+/g, ' ').slice(0, 110)}`);
        }
    }
    return hits.sort();
}

describe('the scanner can actually see', () => {
    it('found the source tree', () => {
        expect(FILES.length).toBeGreaterThan(300);
        expect(FILES.some(f => f.includes(join('features', 'weather')))).toBe(true);
    });

    it('BLIND-SPOT REGRESSION — the pattern matches a bare toLocaleString on a Date', () => {
        // The exact shape that escaped: no arguments, no `hour` token, renders a
        // full date and time by default. If this assertion ever fails, the guard
        // has gone back to matching a spelling instead of the behaviour.
        const sample = 'const x = new Date(item.capturedAt).toLocaleString();';
        expect(DATE_TO_LOCALE_STRING.test(sample)).toBe(true);
    });

    it('BLIND-SPOT REGRESSION — the pattern matches across lines', () => {
        const sample = 'new Intl.DateTimeFormat("en-IN", {\n  hour: "2-digit",\n})';
        expect(INTL_TIME_FORMATTER.test(sample)).toBe(true);
    });

    it('does NOT flag number formatting, which is the common legitimate use', () => {
        expect(DATE_TO_LOCALE_STRING.test("Rs {amount.toLocaleString('en-IN')}")).toBe(false);
        expect(DATE_TO_LOCALE_STRING.test('total.toLocaleString()')).toBe(false);
    });
});

/**
 * A `Date` rendered through `toLocaleString`, WHATEVER the arguments — including
 * none. Keyed on the receiver being a `Date`, so the ~30 money call sites are
 * untouched.
 */
const DATE_TO_LOCALE_STRING = /new\s+Date\s*\([\s\S]{0,200}?\)\s*\.toLocaleString\s*\(/;

/** Any `toLocaleString` carrying a date/time option, across lines. */
const TEMPORAL_OPTION_TO_LOCALE_STRING =
    /\.toLocaleString\s*\([\s\S]{0,300}?\b(hour|minute|second|timeStyle|dateStyle|timeZone|weekday)\s*:/;

/** An `Intl.DateTimeFormat` that formats a time, across lines. */
const INTL_TIME_FORMATTER =
    /new\s+Intl\.DateTimeFormat\s*\([\s\S]{0,300}?\b(hour|timeStyle)\s*:/;

describe('no user-facing clock bypasses the shared 12-hour formatter', () => {
    it('nothing calls toLocaleTimeString outside the formatter', () => {
        expect(
            offenders(/\.toLocaleTimeString\s*\(/),
            'Use formatDisplayTime from shared/utils/displayTime — it pins IST and 12-hour '
            + 'AM/PM. A bare toLocaleTimeString follows the DEVICE locale and reads 24-hour on '
            + 'any handset set to it.',
        ).toEqual([]);
    });

    it('no Date is rendered through toLocaleString, with or without options', () => {
        expect(
            offenders(DATE_TO_LOCALE_STRING),
            'A bare `new Date(x).toLocaleString()` renders a full date AND time in the DEVICE '
            + 'locale and timezone — 24-hour on any handset set to it. This is the form that '
            + 'escaped the first version of this guard. Use formatDisplayDateTime or '
            + 'formatDisplayTimestamp.',
        ).toEqual([]);
    });

    it('nothing passes a date or time option to toLocaleString', () => {
        expect(
            offenders(TEMPORAL_OPTION_TO_LOCALE_STRING),
            'Use shared/utils/displayTime.',
        ).toEqual([]);
    });

    it('nothing constructs an Intl time formatter outside the formatter', () => {
        expect(offenders(INTL_TIME_FORMATTER), 'Use shared/utils/displayTime.').toEqual([]);
    });

    it('nothing uses timeStyle anywhere outside the formatter', () => {
        // A time formatter with no `hour` token in it — blind spot 3.
        expect(offenders(/\btimeStyle\s*:/), 'Use shared/utils/displayTime.').toEqual([]);
    });

    it('nothing asks for 24-hour output explicitly', () => {
        expect(
            offenders(/hour12\s*:\s*false/),
            'Founder decision 2026-08-16: user-facing times are 12-hour with AM and PM.',
        ).toEqual([]);
    });

    it('no 24-hour locale is used for a time', () => {
        expect(
            offenders(/toLocaleTimeString\s*\(\s*['"]en-GB['"]/),
            'en-GB renders 24-hour clocks.',
        ).toEqual([]);
    });
});
