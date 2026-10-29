/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I23 / N4, founder D-16) — the वही's paging
 * steps one day past the range the SERVER returned (never a week start of its own), never asks for
 * the future, and its heading names the exact dates shown.
 */
import { describe, it, expect } from 'vitest';
import {
    isCurrentPeriod, nextPeriodAnchor, previousPeriodAnchor, vahiHeading, windowRangeOf,
} from '../vahiPeriod';

const TODAY = '2026-10-29'; // a Thursday
const page = (windowFrom: string, windowTo: string) => ({ dashboard: { windowFrom, windowTo } }) as never;

describe('vahiPeriod — paging asks the server, one day past its own range', () => {
    it('turning back asks for the day before the range; across a month edge too', () => {
        expect(previousPeriodAnchor('2026-10-26')).toBe('2026-10-25');
        expect(previousPeriodAnchor('2026-10-01')).toBe('2026-09-30');
        expect(previousPeriodAnchor('2026-01-01')).toBe('2025-12-31');
    });

    it('an unbounded range (आजपर्यंत) has nothing to turn back from', () => {
        expect(previousPeriodAnchor('')).toBeNull();
    });

    it('no next period once the range reaches today (no future हजेरी)', () => {
        expect(isCurrentPeriod('2026-10-29', TODAY)).toBe(true);
        expect(nextPeriodAnchor('2026-10-29', TODAY)).toBeUndefined();
    });

    it('the period after last week is the current one, asked for by its first day', () => {
        expect(nextPeriodAnchor('2026-10-25', TODAY)).toBe('2026-10-26');
    });

    it('an older period steps to the day after its end', () => {
        expect(nextPeriodAnchor('2026-10-18', TODAY)).toBe('2026-10-19');
        expect(nextPeriodAnchor('2026-08-31', TODAY)).toBe('2026-09-01');
    });
});

describe('vahiPeriod — the heading names the dates actually shown (N4)', () => {
    it('this week: its exact range, and that it ends today', () => {
        expect(vahiHeading(page('2026-10-26', '2026-10-29'), TODAY)).toBe('२६–२९ ऑक्टो · आजपर्यंत');
    });

    it('a past week: the whole range, nothing about today', () => {
        expect(vahiHeading(page('2026-10-19', '2026-10-25'), TODAY)).toBe('१९–२५ ऑक्टो');
    });

    it('a past month straddling nothing: its first to last day', () => {
        expect(vahiHeading(page('2026-09-01', '2026-09-30'), TODAY)).toBe('१–३० सप्टें');
    });

    it('a week across two months names both', () => {
        expect(windowRangeOf(page('2026-09-28', '2026-10-04'))).toBe('२८ सप्टें – ४ ऑक्टो');
    });

    it('an unbounded window has no range to state — never an invented one', () => {
        expect(vahiHeading(page('', ''), TODAY)).toBe('');
    });
});
