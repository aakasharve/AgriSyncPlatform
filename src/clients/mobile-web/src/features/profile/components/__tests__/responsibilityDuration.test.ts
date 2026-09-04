import { describe, expect, it } from 'vitest';
import {
    DURATION_CHIPS,
    expiryUtcForChip,
    responsibilityEndLine,
} from '../responsibilityDuration';

// A fixed local moment: 2 Sep 2026, 14:30 local.
const now = new Date(2026, 8, 2, 14, 30);

describe('expiryUtcForChip', () => {
    it('renders the five approved chips, verbatim, in order', () => {
        expect(DURATION_CHIPS.map(c => c.label)).toEqual(['आज', '2 दिवस', '3 दिवस', 'तारीख', 'कायम']);
    });

    it('आज ends at the next local midnight', () => {
        expect(expiryUtcForChip('today', now)).toBe(new Date(2026, 8, 3).toISOString());
    });

    it('N दिवस counts local days INCLUDING today', () => {
        expect(expiryUtcForChip('twoDays', now)).toBe(new Date(2026, 8, 4).toISOString());
        expect(expiryUtcForChip('threeDays', now)).toBe(new Date(2026, 8, 5).toISOString());
    });

    it('a picked तारीख runs THROUGH that date', () => {
        expect(expiryUtcForChip('date', now, '2026-09-04')).toBe(new Date(2026, 8, 5).toISOString());
    });

    it('कायम is null — and a bad picked date must NEVER become कायम', () => {
        expect(expiryUtcForChip('permanent', now)).toBeNull();
        expect(() => expiryUtcForChip('date', now, 'not-a-date')).toThrow();
        expect(() => expiryUtcForChip('date', now)).toThrow();
    });
});

describe('responsibilityEndLine', () => {
    it('names the day the responsibility runs THROUGH, in the approved pattern', () => {
        // Expiry at local midnight 5 Sep => runs through 4 Sep — the founder's own example.
        const line = responsibilityEndLine(new Date(2026, 8, 5).toISOString());
        expect(line).toBe('4 सप्टेंबरपर्यंत · नंतर जबाबदारी आपोआप संपेल');
    });

    it('कायम has no end line', () => {
        expect(responsibilityEndLine(null)).toBe('');
    });

    it('never uses permission vocabulary', () => {
        const line = responsibilityEndLine(new Date(2026, 8, 5).toISOString());
        expect(line).not.toMatch(/permission|grant|role|claim|policy|access/i);
    });
});
