import { describe, expect, it } from 'vitest';
import { mergeTeamWithServerRoster, isOwnerTierRole } from '../helpers/teamRoster';
import type { FarmOperator } from '../../../types';
import type { LabourPermission } from '../data/labourPermissionsClient';

const op = (id: string, name: string, role: FarmOperator['role']): FarmOperator =>
    ({ id, name, role, capabilities: [], isVerifier: false, isActive: true }) as FarmOperator;
const row = (userId: string, role: string, displayName: string | null, status = 'Active'): LabourPermission => ({
    userId, role, status, displayName, canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null,
});

describe('mergeTeamWithServerRoster', () => {
    const pulled = [op('o', 'Owner', 'PRIMARY_OWNER'), op('m', 'Shankar', 'UNKNOWN')];

    it('without a roster (non-owner / offline / failure) returns the list untouched', () => {
        expect(mergeTeamWithServerRoster(pulled, null)).toBe(pulled);
        expect(mergeTeamWithServerRoster(pulled, undefined)).toBe(pulled);
    });

    it('gives real roles to pulled members and adds the missing co-owner', () => {
        const merged = mergeTeamWithServerRoster(pulled, [
            row('o', 'PrimaryOwner', 'Owner'),
            row('m', 'Mukadam', 'Shankar'),
            row('c', 'SecondaryOwner', 'Sunita'),
            row('w', 'Worker', 'Raju'),
        ]);
        expect(merged.map(m => [m.name, m.role])).toEqual([
            ['Owner', 'PRIMARY_OWNER'], ['Sunita', 'SECONDARY_OWNER'], ['Shankar', 'MUKADAM'], ['Raju', 'WORKER'],
        ]);
    });

    it('never invents a name or a role', () => {
        const merged = mergeTeamWithServerRoster(pulled, [
            row('x', 'Mukadam', null),
            row('y', 'Mukadam', '   '),
            row('z', 'Agronomist', 'Zoya'),
            row('s', 'Worker', 'Suspended Sam', 'Suspended'),
        ]);
        expect(merged.find(m => m.id === 'x' || m.id === 'y')).toBeUndefined();
        expect(merged.find(m => m.id === 's')).toBeUndefined();
        expect(merged.find(m => m.id === 'z')?.role).toBe('UNKNOWN');
        expect(merged.find(m => m.id === 'm')?.role).toBe('UNKNOWN'); // not in roster: untouched
    });

    it('only owner/co-owner count as owner tier', () => {
        expect(isOwnerTierRole('PrimaryOwner')).toBe(true);
        expect(isOwnerTierRole('SecondaryOwner')).toBe(true);
        for (const r of ['Mukadam', 'Worker', '', undefined, null]) expect(isOwnerTierRole(r)).toBe(false);
    });
});
