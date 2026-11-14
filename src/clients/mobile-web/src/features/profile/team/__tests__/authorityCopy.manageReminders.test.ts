/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1b (founder B9, reversing the REM-1 m2 ruling). "आठवणींची मांडणी बदलणे" may be held
 * by a मुकादम or a सहमालक / कुटुंब seat of ANY plot scope; only the कामगार label can never hold it. The server refuses it for a कामगार label and lists
 * it as "not in force" on that team card only; the personal invitation builder follows the same rule, so no card offers a switch the server would
 * refuse, and the card says why in each language (one language at a time), without claiming that the whole farm is needed.
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY } from '../../../../core/session/farmAuthorities';
import { authorityCopy } from '../authorityCopy';
import { notInForce, presetGrant } from '../../../invitations/invitationModel';

describe('the invitation builder: not in force only for a कामगार label', () => {
    it('a कामगार label is ruled out on every scope', () => {
        expect(notInForce({ label: 'Worker', plotScope: 'AllPlots' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'Worker', plotScope: 'ChosenPlots' })).toContain(AUTHORITY.manageReminders);
        expect(notInForce({ label: 'Worker', plotScope: 'OwnWork' })).toContain(AUTHORITY.manageReminders);
    });

    it('a मुकादम and a सहमालक / कुटुंब seat are never ruled out, whatever plots they see', () => {
        for (const label of ['Mukadam', 'CoOwner', 'Family'] as const) {
            for (const plotScope of ['AllPlots', 'ChosenPlots', 'OwnWork'] as const) {
                expect(notInForce({ label, plotScope }), `${label} on ${plotScope}`).not.toContain(AUTHORITY.manageReminders);
            }
        }
        expect(notInForce(presetGrant('Mukadam'))).not.toContain(AUTHORITY.manageReminders);
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

    it('the line names the कामगार and no longer says the whole farm is needed', () => {
        const mr = authorityCopy('mr').notInForceWhy.ManageReminders ?? '';
        const en = authorityCopy('en').notInForceWhy.ManageReminders ?? '';
        expect(mr).toContain('कामगार');
        expect(mr).not.toContain('संपूर्ण शेत');
        expect(en.toLowerCase()).toContain('worker');
        expect(en.toLowerCase()).not.toContain('whole farm');
    });
});
