/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1, CTO ruling on review m2. "आठवणींची मांडणी बदलणे" may be held only by a
 * whole-farm seat: the server refuses it for a कामगार label, a chosen-plots seat and a स्वतःचं काम seat and lists it as "not in force" on the team
 * card; the personal invitation builder follows the same rule, so no card offers a switch the server would refuse, and the card says why in each
 * language (one language at a time).
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY } from '../../../../core/session/farmAuthorities';
import { authorityCopy } from '../authorityCopy';
import { notInForce, presetGrant } from '../../../invitations/invitationModel';

describe('the invitation builder: not in force for a seat that sees only part of the farm', () => {
    it('a कामगार label, a chosen-plots seat and a स्वतःचं काम seat are ruled out; a whole-farm seat is not', () => {
        expect(notInForce({ label: 'Worker', plotScope: 'AllPlots' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'Mukadam', plotScope: 'ChosenPlots' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'Mukadam', plotScope: 'OwnWork' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'CoOwner', plotScope: 'ChosenPlots' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce(presetGrant('Mukadam'))).not.toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'CoOwner', plotScope: 'AllPlots' })).not.toContain(AUTHORITY.manageReminders);
    });
});

describe('the team card says why, in one language at a time', () => {
    it('the "not in force" line exists in both languages and does not mix them', () => {
        const mr = authorityCopy('mr').notInForceWhy.ManageReminders;
        const en = authorityCopy('en').notInForceWhy.ManageReminders;
        expect(mr).toBeTruthy();
        expect(mr).not.toMatch(/[A-Za-z]/);
        expect(en).toBeTruthy();
        expect(en).not.toMatch(/[ऀ-ॿ]/);
    });
});
