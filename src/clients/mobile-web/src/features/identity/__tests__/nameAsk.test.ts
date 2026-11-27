/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; CTO ruling Q5 = A) - the 8-day ask, on his own card only: when the second
 * name is still empty and a suggestion exists, once on or after day 8 (day 0 = his card's last save, or the first time this phone saw a card that
 * was never saved), and again 8 days after each "नंतर".
 */
import { describe, expect, it } from 'vitest';
import { ASK_AFTER_DAYS, laterUntil, nameAskDue } from '../nameAsk';

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString();
const base = { target: 'mr' as const, secondNameSaved: false, suggestion: 'गणेश पवार', updatedAtUtc: day(0), firstSeenAt: null, laterUntilAt: null };

describe('nameAskDue', () => {
    it('8 days', () => expect(ASK_AFTER_DAYS).toBe(8));

    it('not before day 8; on day 8 and after, yes', () => {
        expect(nameAskDue({ ...base, now: new Date(day(7)) })).toBe(false);
        expect(nameAskDue({ ...base, now: new Date(day(8)) })).toBe(true);
        expect(nameAskDue({ ...base, now: new Date(day(30)) })).toBe(true);
    });

    it('never with no suggestion, no second box, or a second name already saved', () => {
        const now = new Date(day(20));
        expect(nameAskDue({ ...base, suggestion: null, now })).toBe(false);
        expect(nameAskDue({ ...base, target: null, now })).toBe(false);
        expect(nameAskDue({ ...base, secondNameSaved: true, now })).toBe(false);
    });

    it('a card never saved counts from the first time this phone saw it; nothing known yet: no ask', () => {
        expect(nameAskDue({ ...base, updatedAtUtc: null, firstSeenAt: day(10), now: new Date(day(17)) })).toBe(false);
        expect(nameAskDue({ ...base, updatedAtUtc: null, firstSeenAt: day(10), now: new Date(day(18)) })).toBe(true);
        expect(nameAskDue({ ...base, updatedAtUtc: null, firstSeenAt: null, now: new Date(day(99)) })).toBe(false);
    });

    it('"नंतर" waits 8 more days', () => {
        const tapped = new Date(day(9));
        const until = laterUntil(tapped);
        expect(until).toBe(day(17));
        expect(nameAskDue({ ...base, laterUntilAt: until, now: new Date(day(16)) })).toBe(false);
        expect(nameAskDue({ ...base, laterUntilAt: until, now: new Date(day(17)) })).toBe(true);
    });
});
