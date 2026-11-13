/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2; the server enforces AssignWork and SeeAllTasks since L8c-1).
 * The phone's switch list is the server's `FarmAuthorities.Switchable`, in its order; both new authorities have words on the
 * team card and in the personal invitation, one language at a time; an invitation that grants them says so.
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY, SWITCHABLE_AUTHORITIES, authorityNeeds } from '../../../../core/session/farmAuthorities';
import { authorityCopy, authorityLabel } from '../authorityCopy';
import { INVITATION_COPY_FOR_TESTS } from '../../../invitations/invitationCopy';
import { cardLines, presetGrant, withAuthorities } from '../../../invitations/invitationModel';

describe('the switch list is the server\'s Switchable, in its order (L8c-2)', () => {
    it('thirteen switches: ... PlanWork, AssignWork, EditFarmSetup, LabRecords, ScheduleTemplates, SeeAllTasks, SeeCompare (CMP-D1), ManageReminders (REM-1)', () => {
        expect([...SWITCHABLE_AUTHORITIES]).toEqual([
            'TakeAttendance', 'ConfirmRecords', 'SeeMoney', 'SeeWages', 'ReviewMoney', 'PlanWork', 'AssignWork',
            'EditFarmSetup', 'LabRecords', 'ScheduleTemplates', 'SeeAllTasks', 'SeeCompare', 'ManageReminders',
        ]);
        expect(AUTHORITY.seeAllTasks).toBe('SeeAllTasks');
    });

    it('neither new authority needs another (the server lists no dependency for them)', () => {
        expect(authorityNeeds(AUTHORITY.assignWork)).toBeNull();
        expect(authorityNeeds(AUTHORITY.seeAllTasks)).toBeNull();
    });
});

describe('the words, one language at a time', () => {
    it('the team card: Marathi only in Marathi mode, English only in English mode', () => {
        for (const name of [AUTHORITY.assignWork, AUTHORITY.seeAllTasks]) {
            const mr = authorityLabel(authorityCopy('mr'), name);
            const en = authorityLabel(authorityCopy('en'), name);
            expect(mr).not.toBe('');
            expect(mr).not.toMatch(/[A-Za-z]/);
            expect(en).not.toBe('');
            expect(en).not.toMatch(/[ऀ-ॿ]/);
        }
    });

    it('the invitation card words: both languages, none missing', () => {
        const both: { mr: { can: Record<string, string> }; en: { can: Record<string, string> } } = INVITATION_COPY_FOR_TESTS;
        for (const name of [AUTHORITY.assignWork, AUTHORITY.seeAllTasks]) {
            expect(both.mr.can[name]).toBeTruthy();
            expect(both.mr.can[name]).not.toMatch(/[A-Za-z]/);
            expect(both.en.can[name]).toBeTruthy();
            expect(both.en.can[name]).not.toMatch(/[ऀ-ॿ]/);
        }
    });

    it('an invitation that grants AssignWork says "काम सोपवू शकतात" on the card', () => {
        const grant = withAuthorities(presetGrant('Mukadam'), [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'AssignWork', expiresAtUtc: null }]);
        const lines = cardLines({ ...grant, plotNames: [] }, INVITATION_COPY_FOR_TESTS.mr, 'mr').authorities;
        expect(lines).toContain('काम सोपवू शकतात');
    });
});
