/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81). "तुलना पाहणे" has a switch on the
 * owner's team card (the server's `FarmAuthorities.Switchable`, last), a word in each language on the card and in the
 * personal invitation, and it is "not in force" for a कामगार (the server refuses a grant to a Worker seat).
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY, SWITCHABLE_AUTHORITIES, authorityNeeds } from '../../../../core/session/farmAuthorities';
import { authorityCopy, authorityLabel } from '../authorityCopy';
import { INVITATION_COPY_FOR_TESTS } from '../../../invitations/invitationCopy';
import { createBody, notInForce, presetGrant, withAuthorities, cardLines } from '../../../invitations/invitationModel';

describe('the authority exists on the phone the way the server has it', () => {
    it('is named SeeCompare, switchable, in the server\'s order (after SeeAllTasks, before the reminder switch of lane REM-1), and needs nothing', () => {
        expect(AUTHORITY.seeCompare).toBe('SeeCompare');
        expect([...SWITCHABLE_AUTHORITIES].at(-2)).toBe('SeeCompare');
        expect([...SWITCHABLE_AUTHORITIES].at(-1)).toBe('ManageReminders');
        expect(SWITCHABLE_AUTHORITIES).toHaveLength(13);
        expect(authorityNeeds(AUTHORITY.seeCompare)).toBeNull();
    });

    it('every switchable authority has a Marathi and an English word on the card and in the invitation', () => {
        for (const name of SWITCHABLE_AUTHORITIES) {
            expect(authorityLabel(authorityCopy('mr'), name), `mr label ${name}`).not.toBe('');
            expect(authorityLabel(authorityCopy('en'), name), `en label ${name}`).not.toBe('');
            expect(INVITATION_COPY_FOR_TESTS.mr.can[name], `mr invitation ${name}`).toBeTruthy();
            expect(INVITATION_COPY_FOR_TESTS.en.can[name], `en invitation ${name}`).toBeTruthy();
        }
    });
});

describe('the words, one language at a time', () => {
    it('"तुलना पाहणे" is the Marathi word on the team card; the English twin has no Devanagari', () => {
        expect(authorityLabel(authorityCopy('mr'), AUTHORITY.seeCompare)).toBe('तुलना पाहणे');
        const en = authorityLabel(authorityCopy('en'), AUTHORITY.seeCompare);
        expect(en).not.toBe('');
        expect(en).not.toMatch(/[ऀ-ॿ]/);
        expect(authorityLabel(authorityCopy('mr'), AUTHORITY.seeCompare)).not.toMatch(/[A-Za-z]/);
    });

    it('the invitation card: Marathi only in Marathi, English only in English; the line reads on a granted card', () => {
        expect(INVITATION_COPY_FOR_TESTS.mr.can.SeeCompare).not.toMatch(/[A-Za-z]/);
        expect(INVITATION_COPY_FOR_TESTS.en.can.SeeCompare).not.toMatch(/[ऀ-ॿ]/);
        const grant = withAuthorities(presetGrant('Mukadam'), [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'SeeCompare', expiresAtUtc: null }]);
        const lines = cardLines({ ...grant, plotNames: [] }, INVITATION_COPY_FOR_TESTS.mr, 'mr').authorities;
        expect(lines).toContain(INVITATION_COPY_FOR_TESTS.mr.can.SeeCompare);
    });

    it('the "not in force" line for a कामगार exists in both languages', () => {
        expect(authorityCopy('mr').notInForceWhy.SeeCompare).toBeTruthy();
        expect(authorityCopy('mr').notInForceWhy.SeeCompare).not.toMatch(/[A-Za-z]/);
        expect(authorityCopy('en').notInForceWhy.SeeCompare).toBeTruthy();
        expect(authorityCopy('en').notInForceWhy.SeeCompare).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('an invitation to a कामगार never carries it (the server refuses it, so no card promises it)', () => {
    it('is not in force for a Worker, and for no other label', () => {
        expect(notInForce({ label: 'Worker', plotScope: 'OwnWork' })).toContain('SeeCompare');
        expect(notInForce({ label: 'Worker', plotScope: 'ChosenPlots' })).toContain('SeeCompare');
        expect(notInForce({ label: 'Mukadam', plotScope: 'AllPlots' })).not.toContain('SeeCompare');
        expect(notInForce({ label: 'CoOwner', plotScope: 'AllPlots' })).not.toContain('SeeCompare');
    });

    it('createBody leaves it out for a Worker and keeps it for a मुकादम', () => {
        const withIt = (label: 'Worker' | 'Mukadam') =>
            createBody(withAuthorities(presetGrant(label), [{ name: 'SeeCompare', expiresAtUtc: null }]), {}).authorities.map(a => a.name);
        expect(withIt('Worker')).not.toContain('SeeCompare');
        expect(withIt('Mukadam')).toContain('SeeCompare');
    });
});
