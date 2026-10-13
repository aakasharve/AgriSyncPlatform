/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * teamRoster - the owner's Team list, completed from the owner-only server roster.
 *
 * The Team page is built from `/sync/pull` operators, whose role the server cannot
 * read for anyone but the caller (RLS), so a Mukadam arrives role-less and a
 * co-owner not at all. `GET .../labour-permissions` is owner/co-owner-only and
 * carries every member's REAL role and name. This merges it in for DISPLAY only:
 * nothing is persisted, nothing is invented. A member with no name from the server
 * is skipped (no fabricated name); a role the client has no label for becomes
 * UNKNOWN (no label). Without a roster (non-owner, offline, failure) the list is
 * returned untouched, i.e. exactly today's behaviour.
 */
import type { FarmOperator } from '../../../types';
import { capabilitiesForRole } from '../../sync/pull/helpers/operatorRole';
import type { LabourPermission } from '../data/labourPermissionsClient';

export function roleFromServerRoster(role: string): FarmOperator['role'] {
    switch (role) {
        case 'PrimaryOwner': return 'PRIMARY_OWNER';
        case 'SecondaryOwner': return 'SECONDARY_OWNER';
        case 'Mukadam': return 'MUKADAM';
        case 'Worker': return 'WORKER';
        default: return 'UNKNOWN';
    }
}

const RANK: Record<FarmOperator['role'], number> = {
    PRIMARY_OWNER: 0, SECONDARY_OWNER: 1, MUKADAM: 2, WORKER: 3, UNKNOWN: 4,
};

/** True when the SERVER told us the caller is owner or co-owner of the farm. */
export function isOwnerTierRole(role: string | null | undefined): boolean {
    return role === 'PrimaryOwner' || role === 'SecondaryOwner';
}

export function mergeTeamWithServerRoster(
    operators: FarmOperator[],
    roster: LabourPermission[] | null | undefined,
): FarmOperator[] {
    if (!roster) return operators;

    const rowsById = new Map(roster.filter(r => r.status === 'Active').map(r => [r.userId, r]));
    const merged: FarmOperator[] = operators.map(op => {
        const row = rowsById.get(op.id);
        if (!row) return op;
        const role = roleFromServerRoster(row.role);
        return { ...op, role, capabilities: capabilitiesForRole(role) };
    });

    const known = new Set(operators.map(op => op.id));
    for (const row of rowsById.values()) {
        if (known.has(row.userId)) continue;
        const name = row.displayName?.trim();
        if (!name) continue; // never show a member under an invented name
        const role = roleFromServerRoster(row.role);
        merged.push({
            id: row.userId,
            name,
            role,
            capabilities: capabilitiesForRole(role),
            isVerifier: role === 'PRIMARY_OWNER' || role === 'SECONDARY_OWNER',
            isActive: true,
        });
    }

    return merged.sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
}
