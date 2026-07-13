import { describe, it, expect } from 'vitest';
import { resolveDueDate } from '../dueDateResolver';

// Fixed reference day. 2026-07-13 is a MONDAY (verified), which lets the
// weekday cases assert concrete dates without a live clock.
const TODAY = '2026-07-13';

describe('resolveDueDate — CLEAR hints resolve to a concrete YYYY-MM-DD', () => {
    it('उद्या → +1 day', () => {
        expect(resolveDueDate('उद्या', TODAY)).toBe('2026-07-14');
    });

    it('परवा → +2 days', () => {
        expect(resolveDueDate('परवा', TODAY)).toBe('2026-07-15');
    });

    it('"३ दिवसांनी" (Devanagari digits) → +3 days', () => {
        expect(resolveDueDate('३ दिवसांनी', TODAY)).toBe('2026-07-16');
    });

    it('"in 5 days" (Latin digits) → +5 days', () => {
        expect(resolveDueDate('in 5 days', TODAY)).toBe('2026-07-18');
    });

    it('आज → today', () => {
        expect(resolveDueDate('आज', TODAY)).toBe(TODAY);
    });

    it('today (English) → today', () => {
        expect(resolveDueDate('today', TODAY)).toBe(TODAY);
    });

    it('tomorrow (English) → +1 day', () => {
        expect(resolveDueDate('tomorrow', TODAY)).toBe('2026-07-14');
    });

    it('weekday name (शुक्रवार / Friday) → next occurrence', () => {
        // Monday 2026-07-13 → coming Friday is 2026-07-17.
        expect(resolveDueDate('शुक्रवार', TODAY)).toBe('2026-07-17');
        expect(resolveDueDate('Friday', TODAY)).toBe('2026-07-17');
    });

    it('same weekday as today → next week (not today)', () => {
        // Farmer would say आज for today; naming Monday means the next Monday.
        expect(resolveDueDate('सोमवार', TODAY)).toBe('2026-07-20');
    });
});

describe('resolveDueDate — VAGUE / absent hints return null (clear-only)', () => {
    it('नंतर (later) → null', () => {
        expect(resolveDueDate('नंतर', TODAY)).toBeNull();
    });

    it('लवकर (soon) → null', () => {
        expect(resolveDueDate('लवकर', TODAY)).toBeNull();
    });

    it('या आठवड्यात (this week) → null', () => {
        expect(resolveDueDate('या आठवड्यात', TODAY)).toBeNull();
    });

    it('कधीतरी (sometime) → null', () => {
        expect(resolveDueDate('कधीतरी', TODAY)).toBeNull();
    });

    it('empty string → null', () => {
        expect(resolveDueDate('', TODAY)).toBeNull();
    });

    it('undefined → null', () => {
        expect(resolveDueDate(undefined, TODAY)).toBeNull();
    });
});

describe('resolveDueDate — local-date safety (roll-over, no Date.now)', () => {
    it('month-end roll-over: 2026-01-31 + उद्या → 2026-02-01', () => {
        expect(resolveDueDate('उद्या', '2026-01-31')).toBe('2026-02-01');
    });

    it('year roll-over: 2026-12-31 + उद्या → 2027-01-01', () => {
        expect(resolveDueDate('उद्या', '2026-12-31')).toBe('2027-01-01');
    });

    it('year roll-over via परवा: 2026-12-31 + परवा → 2027-01-02', () => {
        expect(resolveDueDate('परवा', '2026-12-31')).toBe('2027-01-02');
    });

    it('malformed todayLocalISO → null (defensive)', () => {
        expect(resolveDueDate('उद्या', 'not-a-date')).toBeNull();
    });
});
