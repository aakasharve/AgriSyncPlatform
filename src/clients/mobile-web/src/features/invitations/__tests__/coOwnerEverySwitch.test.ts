/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.4; founder 27 Nov playback "मालक/सहमालक everything", CTO ruling Q4) -
 * a NEW सहमालक invitation starts with every switch on (every responsibility the server enforces, each कायम) and every plot; the owner switches
 * off what he does not want. A label still grants nothing on the server (D-22/D-26): this is only where the switches start. People already on
 * the farm are not changed. The other labels keep their D-26 starting sets.
 */
import { describe, expect, it } from 'vitest';
import { SWITCHABLE_AUTHORITIES } from '../../../core/session/farmAuthorities';
import { createBody, presetGrant } from '../invitationModel';

describe('PERM S5.4 - the सहमालक starting set', () => {
    it('a new सहमालक invitation starts with every switch on', () => {
        const grant = presetGrant('CoOwner');
        expect(grant.plotScope).toBe('AllPlots');
        expect(grant.authorities.map(a => a.name)).toEqual([...SWITCHABLE_AUTHORITIES]);
        expect(grant.authorities.every(a => a.expiresAtUtc === null)).toBe(true);
        // exactly what is shown is sent
        expect(createBody(grant, { name: '', mobile: null }).authorities).toEqual(grant.authorities);
    });

    it('the other labels keep their starting sets', () => {
        expect(presetGrant('Family').authorities.map(a => a.name)).toEqual(['TakeAttendance', 'ConfirmRecords']);
        expect(presetGrant('Mukadam').authorities.map(a => a.name)).toEqual(['TakeAttendance']);
        expect(presetGrant('Worker').authorities).toEqual([]);
    });
});
