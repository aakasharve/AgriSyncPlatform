// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    EMPTY_PREFILL, EMPTY_SELECTION, parseHours, prefillFromCell, sanitizeHoursInput, selectionFromPrefill, toMarkPayload,
} from '../attendanceManual';
import type { LedgerCell } from '../labour.types';

const sel = (over: Partial<typeof EMPTY_SELECTION>) => ({ ...EMPTY_SELECTION, ...over });
const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

describe('attendanceManual - status -> wire mapping', () => {
    it.each([
        ['Full', { dayMark: 'Full' }],
        ['Half', { dayMark: 'Half' }],
        ['Absent', { dayMark: 'Absent' }],
    ] as const)('day chip %s -> %j', (day, expected) => {
        expect(toMarkPayload(sel({ day }))).toEqual(expected);
    });

    it('night toggle -> nightMark Worked, with no day fact invented', () => {
        expect(toMarkPayload(sel({ night: true }))).toEqual({ nightMark: 'Worked' });
    });

    it('day + night together are one mark stating both halves', () => {
        expect(toMarkPayload(sel({ day: 'Half', night: true }))).toEqual({ dayMark: 'Half', nightMark: 'Worked' });
    });

    it('UNTOUCHED is not absent: no selection yields NO mark', () => {
        expect(toMarkPayload(EMPTY_SELECTION)).toBeNull();
    });

    it('hours are stated counts; empty / zero / junk / over a day mean "nothing stated"', () => {
        expect(toMarkPayload(sel({ day: 'Full', hours: '4', extraHours: '1.5' }))).toEqual({ dayMark: 'Full', hoursWorked: 4, extraHours: 1.5 });
        expect(parseHours('')).toBeNull();
        expect(parseHours('0')).toBeNull();
        expect(parseHours('abc')).toBeNull();
        expect(parseHours('25')).toBeNull();
        expect(toMarkPayload(sel({ hours: '0' }))).toBeNull();
    });

    it('a selection equal to what the register already holds is not re-sent', () => {
        const prefill = prefillFromCell(cell({ day: 'full', night: 'worked', hours: 4 }));
        expect(toMarkPayload(selectionFromPrefill(prefill), prefill)).toBeNull();
        // changing only the day sends only the day
        expect(toMarkPayload({ ...selectionFromPrefill(prefill), day: 'Half' }, prefill)).toEqual({ dayMark: 'Half' });
    });

    it('prefill from a null cell is empty; absent maps to Absent', () => {
        expect(prefillFromCell(null)).toEqual(EMPTY_PREFILL);
        expect(prefillFromCell(cell({ day: 'absent' })).day).toBe('Absent');
    });

    it('the hours box only ever holds a bounded number', () => {
        expect(sanitizeHoursInput('4h')).toBe('4');
        expect(sanitizeHoursInput('1.2.3')).toBe('1.23');
        expect(sanitizeHoursInput('99')).toBe('');
    });

    it('never produces a headcount or money key', () => {
        const facts = toMarkPayload(sel({ day: 'Full', night: true, hours: '8', extraHours: '2' })) ?? {};
        expect(Object.keys(facts).sort()).toEqual(['dayMark', 'extraHours', 'hoursWorked', 'nightMark']);
    });
});
