/**
 * labourPermissionsClient tests — LABOUR_PHASE2 Phase 5, the UI half.
 *
 * Locks the wire contract the switch depends on:
 *   - both routes go through the SHARED api client (no private fetch()),
 *   - the PUT carries DESIRED STATE, so a retry converges instead of
 *     oscillating,
 *   - a 409 `LabourManagementCarriedByRole` is recognised NARROWLY, so an
 *     owner is never told the wrong reason a switch would not move,
 *   - failures propagate. A switch that silently fails to move is the exact
 *     defect this module exists to remove (`P5`).
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPut = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        http: {
            get: (...args: unknown[]) => mockGet(...args),
            put: (...args: unknown[]) => mockPut(...args),
        },
    },
}));

import {
    fetchLabourPermissions,
    isCarriedByRoleError,
    labourPermissionPath,
    labourPermissionsPath,
    setLabourPermission,
    LABOUR_CAPABILITY_CARRIED_BY_ROLE,
    type LabourPermission,
} from '../data/labourPermissionsClient';

const ok = (body: unknown) => ({ status: 200, data: body });

/** As the Phase 5 endpoint serves it: an owner, a Mukadam, a worker. */
const roster = (): LabourPermission[] => [
    {
        userId: 'user-owner', role: 'PrimaryOwner', status: 'Active',
        canManageLabourRecords: true, hasExplicitGrant: false,
        source: 'OwnerTier', isGrantEditable: false, labourGrantExpiresAtUtc: null,
    },
    {
        userId: 'user-mukadam', role: 'Mukadam', status: 'Active',
        canManageLabourRecords: false, hasExplicitGrant: false,
        source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null,
    },
    {
        userId: 'user-worker', role: 'Worker', status: 'Active',
        canManageLabourRecords: false, hasExplicitGrant: false,
        source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null,
    },
];

beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
});

describe('fetchLabourPermissions', () => {
    it('issues GET on the Phase 5 route through the shared api client', async () => {
        mockGet.mockResolvedValueOnce(ok(roster()));

        await fetchLabourPermissions('farm-123');

        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet.mock.calls[0][0]).toBe('/shramsafal/farms/farm-123/labour-permissions');
        expect(labourPermissionsPath('farm-123'))
            .toBe('/shramsafal/farms/farm-123/labour-permissions');
    });

    it('returns the server rows, including the two fields the switch depends on', async () => {
        mockGet.mockResolvedValueOnce(ok(roster()));

        const rows = await fetchLabourPermissions('farm-123');

        // `isGrantEditable: false` is what makes a role-carried switch render
        // permanently on and non-interactive. Dropping it in a mapper would
        // silently restore the mock behaviour. Since 2026-09-02 (D5) only
        // owner-tier is role-carried — a Mukadam's switch is real and editable.
        expect(rows.find(r => r.userId === 'user-mukadam')).toMatchObject({
            canManageLabourRecords: false,
            isGrantEditable: true,
            source: 'NotGranted',
        });
        expect(rows.find(r => r.userId === 'user-worker')).toMatchObject({
            canManageLabourRecords: false,
            isGrantEditable: true,
        });
    });

    it('carries SERVER user ids, which are the only ids a PUT may target', async () => {
        // `profile.operators[].id` is a LOCAL profile id and there is no
        // mapping between the two. If the roster ever came from the profile,
        // every PUT would address a user the server has never seen.
        mockGet.mockResolvedValueOnce(ok(roster()));

        const rows = await fetchLabourPermissions('farm-123');

        expect(rows.map(r => r.userId))
            .toEqual(['user-owner', 'user-mukadam', 'user-worker']);
    });

    it('propagates a failure rather than inventing a roster', async () => {
        mockGet.mockRejectedValueOnce(new Error('network down'));
        await expect(fetchLabourPermissions('farm-123')).rejects.toThrow('network down');
    });
});

describe('setLabourPermission', () => {
    it('issues PUT on the per-member route with the DESIRED state', async () => {
        mockPut.mockResolvedValueOnce(ok(roster()[2]));

        await setLabourPermission('farm-123', 'user-worker', true);

        expect(mockPut).toHaveBeenCalledTimes(1);
        expect(mockPut.mock.calls[0][0])
            .toBe('/shramsafal/farms/farm-123/labour-permissions/user-worker');
        expect(labourPermissionPath('farm-123', 'user-worker'))
            .toBe('/shramsafal/farms/farm-123/labour-permissions/user-worker');
    });

    it('sends what should be TRUE, never a toggle verb', async () => {
        // A farmer on a rural connection who taps, loses signal and retries
        // must land on the state he chose, not oscillate back out of it.
        mockPut.mockResolvedValueOnce(ok(roster()[2]));
        await setLabourPermission('farm-123', 'user-worker', true);
        expect(mockPut.mock.calls[0][1]).toEqual(
            { canManageLabourRecords: true, labourGrantExpiresAtUtc: null });

        mockPut.mockResolvedValueOnce(ok(roster()[2]));
        await setLabourPermission('farm-123', 'user-worker', false);
        expect(mockPut.mock.calls[1][1]).toEqual(
            { canManageLabourRecords: false, labourGrantExpiresAtUtc: null });
    });

    it('resending the same desired state sends the same body — it is idempotent', async () => {
        mockPut.mockResolvedValue(ok(roster()[2]));

        await setLabourPermission('farm-123', 'user-worker', true);
        await setLabourPermission('farm-123', 'user-worker', true);

        expect(mockPut.mock.calls[0][1]).toEqual(mockPut.mock.calls[1][1]);
    });

    it('returns the row the SERVER now holds, not the value we asked for', async () => {
        // `source` and `isGrantEditable` are recomputed server-side. A caller
        // that wrote back its own boolean would display rules it had stopped
        // tracking.
        const granted: LabourPermission = {
            userId: 'user-worker', role: 'Worker', status: 'Active',
            canManageLabourRecords: true, hasExplicitGrant: true,
            source: 'ExplicitGrant', isGrantEditable: true, labourGrantExpiresAtUtc: null,
        };
        mockPut.mockResolvedValueOnce(ok(granted));

        expect(await setLabourPermission('farm-123', 'user-worker', true)).toEqual(granted);
    });

    it('propagates a refusal instead of swallowing it', async () => {
        mockPut.mockRejectedValueOnce(new Error('403'));
        await expect(setLabourPermission('farm-123', 'user-owner', false))
            .rejects.toThrow('403');
    });
});

describe('isCarriedByRoleError — narrow on purpose', () => {
    const carried = {
        response: { status: 409, data: { error: LABOUR_CAPABILITY_CARRIED_BY_ROLE } },
    };

    it('recognises the 409 the server sends for a role-carried capability', () => {
        expect(isCarriedByRoleError(carried)).toBe(true);
    });

    it('does not claim a 403 is a role-carried refusal', () => {
        // A non-owner, a self-target and an unknown farm all return 403 with an
        // EMPTY body. Telling that owner "they have it through their role"
        // would be a fabricated explanation he cannot act on.
        expect(isCarriedByRoleError({ response: { status: 403, data: '' } })).toBe(false);
    });

    it('does not claim a DIFFERENT 409 is this one', () => {
        expect(isCarriedByRoleError({
            response: { status: 409, data: { error: 'ShramSafal.SomethingElse' } },
        })).toBe(false);
    });

    it('requires the STATUS as well as the code, not just the code', () => {
        // Added after a mutation survived: the 403 case above sends an empty
        // STRING body, so the object guard rejected it before the status check
        // was ever reached — deleting `status !== 409` broke nothing and the
        // suite stayed green. This is the case that actually exercises it: the
        // right code on the wrong status. Both must agree before an owner is
        // told his member holds the capability by role.
        expect(isCarriedByRoleError({
            response: { status: 403, data: { error: LABOUR_CAPABILITY_CARRIED_BY_ROLE } },
        })).toBe(false);
        expect(isCarriedByRoleError({
            response: { status: 400, data: { error: LABOUR_CAPABILITY_CARRIED_BY_ROLE } },
        })).toBe(false);
        expect(isCarriedByRoleError({
            response: { status: 200, data: { error: LABOUR_CAPABILITY_CARRIED_BY_ROLE } },
        })).toBe(false);
    });

    it('survives every shape a thrown value can take', () => {
        expect(isCarriedByRoleError(null)).toBe(false);
        expect(isCarriedByRoleError(undefined)).toBe(false);
        expect(isCarriedByRoleError('boom')).toBe(false);
        expect(isCarriedByRoleError(new Error('boom'))).toBe(false);
        expect(isCarriedByRoleError({ response: { status: 409 } })).toBe(false);
        expect(isCarriedByRoleError({ response: { status: 409, data: null } })).toBe(false);
    });

    it('pins the exact code string the server sends', () => {
        // A typo here fails open into the generic message — survivable, but the
        // owner then cannot tell why the switch will not move.
        expect(LABOUR_CAPABILITY_CARRIED_BY_ROLE)
            .toBe('ShramSafal.LabourManagementCarriedByRole');
    });
});
