// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reviewDetailDate tests — Decision 4b (2026-07-19, screen honesty).
 *
 * Locks two behaviours:
 *   - `formatReviewDetail` recognises the backend's bare `yyyy-MM-dd` shape
 *     and reformats it (आज/काल/"१९ जुलै"); anything else passes through
 *     unchanged (never invents content for a non-date `detail`).
 *   - `isReviewDetailWithinDays` bounds only parseable ISO dates; a
 *     non-date `detail` (mock/preview) is always kept.
 */
import { describe, it, expect } from 'vitest';
import { formatReviewDetail, isReviewDetailWithinDays, parseReviewDetailDate } from '../reviewDetailDate';

describe('parseReviewDetailDate', () => {
    it('parses an exact yyyy-MM-dd string', () => {
        const d = parseReviewDetailDate('2026-07-19');
        expect(d).not.toBeNull();
        expect(d?.getFullYear()).toBe(2026);
        expect(d?.getMonth()).toBe(6); // July (0-indexed)
        expect(d?.getDate()).toBe(19);
    });

    it('rejects anything that is not exactly that shape', () => {
        expect(parseReviewDetailDate('द्राक्ष-२ · आज')).toBeNull();
        expect(parseReviewDetailDate('detail-r1')).toBeNull();
        expect(parseReviewDetailDate('2026-07-19T00:00:00Z')).toBeNull();
        expect(parseReviewDetailDate('')).toBeNull();
    });
});

describe('formatReviewDetail', () => {
    const today = new Date(2026, 6, 19); // 19 July 2026

    it('formats today as आज', () => {
        expect(formatReviewDetail('2026-07-19', today)).toBe('आज');
    });

    it('formats yesterday as काल', () => {
        expect(formatReviewDetail('2026-07-18', today)).toBe('काल');
    });

    it('formats an older date as day + Marathi month (no raw ISO, no English)', () => {
        const label = formatReviewDetail('2026-07-10', today);
        expect(label).not.toMatch(/2026|-07-|July/i);
        expect(label).toContain('जुलै');
    });

    it('passes a non-date detail string through unchanged (mock/preview)', () => {
        expect(formatReviewDetail('द्राक्ष-२ · आज', today)).toBe('द्राक्ष-२ · आज');
        expect(formatReviewDetail('detail-r1', today)).toBe('detail-r1');
    });
});

describe('isReviewDetailWithinDays', () => {
    const today = new Date(2026, 6, 19);

    it('keeps a date within the bound', () => {
        expect(isReviewDetailWithinDays('2026-07-10', 14, today)).toBe(true); // 9 days old
    });

    it('drops a date older than the bound', () => {
        expect(isReviewDetailWithinDays('2026-06-01', 14, today)).toBe(false); // ~48 days old
    });

    it('keeps a non-date detail string regardless (mock/preview never bounded)', () => {
        expect(isReviewDetailWithinDays('द्राक्ष-२ · आज', 14, today)).toBe(true);
        expect(isReviewDetailWithinDays('detail-anything', 14, today)).toBe(true);
    });
});
