// spec: plr-d10-redesign-real-integration-2026-10-25 (WP-1 A9) — which days a manual हजेरी may be for.
import { describe, it, expect } from 'vitest';
import { attendanceTitleFor, choosableWorkDates, recentWorkDates, workDateChipLabel, type RegisterOnScreen } from '../attendanceDay';

const TODAY = '2026-10-25';
const OWNER_FRESH_ALLTIME: RegisterOnScreen = { window: 'alltime', view: 'owner', fresh: true };

describe('which day a manual हजेरी is for', () => {
    it('today first, then the six days before — never a future day', () => {
        expect(recentWorkDates(TODAY)).toEqual([
            '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19',
        ]);
    });

    it('crosses a month, a leap day and a year end without losing a day', () => {
        expect(recentWorkDates('2026-03-02', 3)).toEqual(['2026-03-02', '2026-03-01', '2026-02-28']);
        expect(recentWorkDates('2028-03-01', 2)).toEqual(['2028-03-01', '2028-02-29']);
        expect(recentWorkDates('2027-01-01', 2)).toEqual(['2027-01-01', '2026-12-31']);
    });

    it('the owner\'s view of the server\'s current all-time register: all seven days', () => {
        expect(choosableWorkDates(TODAY, OWNER_FRESH_ALLTIME)).toHaveLength(7);
    });

    it.each([
        ['an old copy (outage)', { ...OWNER_FRESH_ALLTIME, fresh: false }],
        ['a crew view', { ...OWNER_FRESH_ALLTIME, view: 'crew' as const }],
        ['his own row only', { ...OWNER_FRESH_ALLTIME, view: 'own' as const }],
        ['हा आठवडा', { ...OWNER_FRESH_ALLTIME, window: 'week' as const }],
        ['हा महिना', { ...OWNER_FRESH_ALLTIME, window: 'month' as const }],
        ['आज', { ...OWNER_FRESH_ALLTIME, window: 'today' as const }],
    ])('%s: today only — a past day\'s marks might not be on screen', (_name, register) => {
        expect(choosableWorkDates(TODAY, register)).toEqual([TODAY]);
    });

    it('register unknown: today only, as before', () => {
        expect(choosableWorkDates(TODAY, undefined)).toEqual([TODAY]);
    });

    it('says the day the way the register does', () => {
        expect(workDateChipLabel('2026-10-25', TODAY)).toBe('आज');
        expect(workDateChipLabel('2026-10-24', TODAY)).toBe('काल');
        expect(workDateChipLabel('2026-10-23', TODAY)).toBe('२३ ऑक्टो');
        expect(attendanceTitleFor('2026-10-25', TODAY)).toBe('आजची हजेरी');
        expect(attendanceTitleFor('2026-10-24', TODAY)).toBe('कालची हजेरी');
        expect(attendanceTitleFor('2026-10-20', TODAY)).toBe('२० ऑक्टोबरची हजेरी');
    });
});
