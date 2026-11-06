/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-1 Task 6; founder D-73, 2026-11-06: "You, plus the people
 * you give 'कामाचं नियोजन करणे'"). "Plan work" is now a switch on a person's card, in both languages (PROPOSED words),
 * because the server enforces it (ScheduleChangeGate) on every planning door (P5).
 */
import { describe, expect, it } from 'vitest';
import { authorityCopy, authorityLabel } from '../authorityCopy';
import { AUTHORITY, SWITCHABLE_AUTHORITIES } from '../../../../core/session/farmAuthorities';

describe('the plan-work responsibility words', () => {
    it('Marathi mode reads Marathi only', () => {
        const label = authorityLabel(authorityCopy('mr'), AUTHORITY.planWork);
        expect(label).toBe('कामाचं नियोजन करणे');
        expect(label).not.toMatch(/[A-Za-z]/);
    });

    it('English mode reads English only', () => {
        const label = authorityLabel(authorityCopy('en'), AUTHORITY.planWork);
        expect(label).toBe('Plan the work');
        expect(label).not.toMatch(/[ऀ-ॿ]/);
    });

    it('is a switch the owner gives, in the order the server lists it (after review money)', () => {
        expect(SWITCHABLE_AUTHORITIES).toContain(AUTHORITY.planWork);
        expect(SWITCHABLE_AUTHORITIES.indexOf(AUTHORITY.planWork)).toBe(SWITCHABLE_AUTHORITIES.indexOf(AUTHORITY.reviewMoney) + 1);
        expect(SWITCHABLE_AUTHORITIES).not.toContain(AUTHORITY.assignWork);
    });
});
