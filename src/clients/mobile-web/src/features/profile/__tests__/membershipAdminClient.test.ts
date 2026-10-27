/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner-decision client's wire contract:
 * each decision goes to its own route through the SHARED api client, with exactly the body the
 * server reads; the two approval choices send the role the PRIMARY owner picked (the joiner never
 * does; founder D-22 of 26 Oct: no कुटुंब / co-owner choice in step 2);
 * a refusal is recognised narrowly so the owner is told the right reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.fn();
const mockPut = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: {
        http: {
            post: (...args: unknown[]) => mockPost(...args),
            put: (...args: unknown[]) => mockPut(...args),
        },
    },
}));

import {
    approveBodyFor,
    approveMember,
    declineMember,
    membershipErrorKind,
    presetAccessBody,
    removeMember,
    restoreMember,
    setMemberAccess,
    suspendMember,
} from '../data/membershipAdminClient';

const answered = { userId: 'u1', role: 'Worker', status: 'Active' };
const base = '/shramsafal/farms/farm-1/memberships/u1';

beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ status: 200, data: answered });
    mockPut.mockReset().mockResolvedValue({ status: 200, data: answered });
});

describe('approveBodyFor — the primary owner\'s two choices', () => {
    it('काम सांगणे = Worker, काम + हजेरी = Mukadam with the हजेरी व पक्कं grant — and nothing else', () => {
        // The हजेरी व पक्कं switch as DESIRED state both ways (verifier SEC-MU2-1).
        expect(approveBodyFor('work')).toEqual({ role: 'Worker', grantLabour: false });
        expect(approveBodyFor('crew')).toEqual({ role: 'Mukadam', grantLabour: true });
    });

    it('never sends a co-owner role or a permission set (no family choice, no switches in step 2)', () => {
        for (const body of [approveBodyFor('work'), approveBodyFor('crew')]) {
            expect(body.role).not.toBe('SecondaryOwner');
            expect(body).not.toHaveProperty('permissions');
        }
    });
});

describe('presetAccessBody — moving a let-in person to one of the two choices', () => {
    it('always goes back to the new role\'s defaults and sets the हजेरी व पक्कं switch as the choice says', () => {
        expect(presetAccessBody('work')).toEqual({ role: 'Worker', resetPermissions: true, labourGrant: false });
        expect(presetAccessBody('crew')).toEqual({ role: 'Mukadam', resetPermissions: true, labourGrant: true });
    });
});

describe('routes and bodies', () => {
    it('approve posts the chosen role and returns the SERVER row', async () => {
        const row = await approveMember('farm-1', 'u1', { role: 'Mukadam', grantLabour: true });
        expect(mockPost).toHaveBeenCalledWith(`${base}/approve`, { role: 'Mukadam', grantLabour: true });
        expect(row).toEqual(answered);
    });

    it('decline / suspend / remove send the trimmed reason, and no reason when it is blank', async () => {
        await declineMember('farm-1', 'u1', '  ओळखत नाही  ');
        await suspendMember('farm-1', 'u1', '   ');
        await removeMember('farm-1', 'u1', 'काम सोडलं');
        expect(mockPost.mock.calls).toEqual([
            [`${base}/decline`, { reason: 'ओळखत नाही' }],
            [`${base}/suspend`, {}],
            [`${base}/remove`, { reason: 'काम सोडलं' }],
        ]);
    });

    it('restore posts with no reason; access is a PUT of the desired state', async () => {
        await restoreMember('farm-1', 'u1');
        await setMemberAccess('farm-1', 'u1', { role: 'Worker' });
        expect(mockPost).toHaveBeenCalledWith(`${base}/restore`, {});
        expect(mockPut).toHaveBeenCalledWith(`${base}/access`, { role: 'Worker' });
    });

    it('a failure propagates (never swallowed into a fake success)', async () => {
        mockPost.mockRejectedValue({ response: { status: 403 } });
        await expect(approveMember('farm-1', 'u1', { role: 'Worker' })).rejects.toBeTruthy();
    });
});

describe('membershipErrorKind', () => {
    it.each([
        [{ response: { status: 409, data: { error: 'membership.last_owner' } } }, 'last_owner'],
        [{ response: { status: 409, data: { error: 'membership.wrong_status' } } }, 'wrong_status'],
        [{ response: { status: 409, data: { error: 'ShramSafal.LabourManagementCarriedByRole' } } }, 'failed'],
        [{ response: { status: 403 } }, 'forbidden'],
        [{ response: { status: 500 } }, 'failed'],
        [new Error('Network Error'), 'failed'],
        [null, 'failed'],
    ])('%j → %s', (error, kind) => {
        expect(membershipErrorKind(error)).toBe(kind);
    });
});
