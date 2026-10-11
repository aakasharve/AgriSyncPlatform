/**
 * Labour journey fix D2 (spec 2026-08-25-prod-cutover-waves) - the manual door
 * must show when MORE named people are marked present than the day's stated
 * headcount, using the EXISTING headcount-disagreement machinery (no resolver,
 * no new copy). Both statements survive; nothing here returns a number to
 * write back.
 */
import { describe, it, expect } from 'vitest';
import { findMarkedAboveStated, resolveStatedHeadcount } from '../attendanceDisagreement';
import { effectivePresentIds, presentTodayFromLedger } from '../attendanceManual';
import type { LabourData } from '../labour.types';

describe('findMarkedAboveStated', () => {
    it('more people marked present than stated -> the count-vs-composition disagreement, both numbers preserved', () => {
        const d = findMarkedAboveStated(3, ['a', 'b', 'c', 'd', 'e']);
        expect(d).not.toBeNull();
        expect(d!.axes).toEqual(['count-vs-composition']);
        expect(d!.anchored?.headcount).toBe(3);
        expect(d!.uniqueNames).toHaveLength(5);
    });

    it('equal or fewer is no disagreement (naming never has to match)', () => {
        expect(findMarkedAboveStated(3, ['a', 'b', 'c'])).toBeNull();
        expect(findMarkedAboveStated(3, ['a'])).toBeNull();
        expect(findMarkedAboveStated(3, [])).toBeNull();
    });

    it('nothing stated is UNKNOWN, never zero: no disagreement can be manufactured', () => {
        expect(findMarkedAboveStated(null, ['a', 'b'])).toBeNull();
    });

    it('a stated 0 with names marked present IS the extreme case (a stated zero is a statement)', () => {
        expect(findMarkedAboveStated(0, ['a'])).not.toBeNull();
    });
});

describe('resolveStatedHeadcount', () => {
    it('local anchor wins; else the server read-out; else unknown', () => {
        expect(resolveStatedHeadcount({ state: 'anchored', headcount: 4, logId: 'l' }, 3)).toBe(4);
        expect(resolveStatedHeadcount({ state: 'no-anchor' }, 3)).toBe(3);
        expect(resolveStatedHeadcount(undefined, 3)).toBe(3);
        expect(resolveStatedHeadcount({ state: 'no-anchor' }, null)).toBeNull();
    });
});

describe('who counts as marked present', () => {
    it('selection over prefill; absent is not present; night-only is present; untouched keeps the register', () => {
        const ids = effectivePresentIds(
            {
                a: { day: 'Full', night: false, hours: '', extraHours: '' },
                b: { day: 'Absent', night: false, hours: '', extraHours: '' }, // register said present; he says absent
                c: { day: null, night: true, hours: '', extraHours: '' },
            },
            {
                b: { day: 'Full', night: false, hours: null, extraHours: null },
                d: { day: 'Half', night: false, hours: null, extraHours: null }, // untouched, already in register
                e: { day: 'Absent', night: false, hours: null, extraHours: null },
            },
        );
        expect([...ids].sort()).toEqual(['a', 'c', 'd']);
    });

    it('presentTodayFromLedger reads today cells only', () => {
        const cell = (day: 'full' | 'half' | 'absent' | null, night: 'worked' | null = null) =>
            ({ day, night, hours: null, extraHours: null, ukte: false, work: null });
        const data = {
            ledger: {
                days: ['2026-09-01', '2026-09-02'],
                rows: [
                    { fieldOperatorId: 'a', cells: [cell('full'), cell('full')] },
                    { fieldOperatorId: 'b', cells: [cell('full'), cell('absent')] },
                    { fieldOperatorId: 'c', cells: [cell('full'), cell(null, 'worked')] },
                    { fieldOperatorId: 'd', cells: [cell('full'), null] },
                ],
            },
        } as unknown as LabourData;
        expect(presentTodayFromLedger(data, '2026-09-02').sort()).toEqual(['a', 'c']);
        expect(presentTodayFromLedger(data, '2026-09-09')).toEqual([]);
    });
});
