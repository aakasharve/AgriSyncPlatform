/**
 * lane 2b — the phone reads its doors from the server's authorities, never from the label; an
 * older server (no `authorities`) keeps the pre-2b owner-tier answer (P11).
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY, authorityNeeds, holdsAuthority, isPrimaryAccountHolderRole } from '../farmAuthorities';
import { holds, throughDay, withAuthority, withoutAuthority } from '../../../features/profile/team/authoritySwitchModel';

describe('holdsAuthority', () => {
    it('reads the server list, whatever the label says', () => {
        const coOwnerWithNothing = { role: 'SecondaryOwner', authorities: [] };
        expect(holdsAuthority(coOwnerWithNothing, AUTHORITY.editFarmSetup)).toBe(false);
        const workerWithSetup = { role: 'Worker', authorities: [{ name: 'EditFarmSetup', expiresAtUtc: null }] };
        expect(holdsAuthority(workerWithSetup, AUTHORITY.editFarmSetup)).toBe(true);
        expect(holdsAuthority(workerWithSetup, AUTHORITY.takeAttendance)).toBe(false);
    });

    it('an older server (no list) answers the pre-2b owner-tier rule; no farm answers no', () => {
        expect(holdsAuthority({ role: 'SecondaryOwner' }, AUTHORITY.editFarmSetup)).toBe(true);
        expect(holdsAuthority({ role: 'Mukadam' }, AUTHORITY.editFarmSetup)).toBe(false);
        expect(holdsAuthority(null, AUTHORITY.editFarmSetup)).toBe(false);
    });

    it('only the primary owner is the account holder; review money and wages need money', () => {
        expect(isPrimaryAccountHolderRole('PrimaryOwner')).toBe(true);
        expect(isPrimaryAccountHolderRole('SecondaryOwner')).toBe(false);
        expect(authorityNeeds('ReviewMoney')).toBe('SeeMoney');
        expect(authorityNeeds('SeeWages')).toBe('SeeMoney');
        expect(authorityNeeds('TakeAttendance')).toBeNull();
    });
});

describe('the switch model', () => {
    const current = [{ name: 'SeeMoney', expiresAtUtc: null }, { name: 'PlanWork', expiresAtUtc: '2026-11-05T00:00:00.000Z' }];

    it('turning one on keeps everything else exactly; a held dependency is not touched', () => {
        const next = withAuthority(current, 'ReviewMoney', '2026-12-01T00:00:00.000Z');
        expect(next).toEqual([...current, { name: 'ReviewMoney', expiresAtUtc: '2026-12-01T00:00:00.000Z' }]);
        expect(holds(next, 'ReviewMoney')).toBe(true);
    });

    it('turning one off removes only it', () => {
        expect(withoutAuthority(current, 'PlanWork')).toEqual([{ name: 'SeeMoney', expiresAtUtc: null }]);
    });

    it('names the day the responsibility runs THROUGH, or nothing for कायम / an unreadable instant', () => {
        expect(throughDay(new Date(2026, 10, 5).toISOString(), 'mr')).toBe('4 नोव्हेंबर');
        expect(throughDay(null, 'mr')).toBe('');
        expect(throughDay('not a date', 'en')).toBe('');
    });
});
