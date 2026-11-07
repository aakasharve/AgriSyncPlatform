// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2, fix round 1. On "माझी टीम": the one tap on an invitation
 * claim says the server's refusal when there is one (L-3), and a sent invitation opened by someone other than the person
 * it named takes the owner to that claimant's own request card, which shows his name and number (H-1). Only the network
 * is stubbed; the roster hook is the real one.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const fetchLabourPermissions = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
    setLabourPermission: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));
const listInvitations = vi.fn();
const approveInvitationClaim = vi.fn();
vi.mock('../../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../../invitations/personalInvitationClient')>()),
    listInvitations: (...a: unknown[]) => listInvitations(...a),
    approveInvitationClaim: (...a: unknown[]) => approveInvitationClaim(...a),
}));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], ...over,
});
const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
const CLAIM = row({
    userId: 'suresh', status: 'PendingApproval', displayName: 'Suresh', joinedVia: 'PersonalInvitation', requestedAtUtc: '2026-11-06T07:00:00Z',
    phoneLast4: '4321', personalInvitationId: 'inv-1', label: 'CoOwner',
} as Partial<LabourPermission>);

const Harness: React.FC = () => {
    const roster = useLabourPermissions('farm-1');
    return <TeamPage farmId="farm-1" farmCode="K7M2QP" callerRole="PrimaryOwner" callerUserId="me" roster={roster} onShowQr={vi.fn()} />;
};

beforeEach(() => {
    fetchLabourPermissions.mockReset();
    listInvitations.mockReset();
    approveInvitationClaim.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, CLAIM]);
    listInvitations.mockResolvedValue([]);
    Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('L-3: the one tap on an invitation claim', () => {
    it('says why the server refused it', async () => {
        approveInvitationClaim.mockRejectedValue({ response: { status: 409, data: { error: 'membership.wrong_status' } } });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('let-in-suresh'));
        await waitFor(() => expect(screen.getByTestId('team-invitation-refusal').textContent)
            .toBe('ही विनंती आधीच बदलली आहे. यादी पुन्हा आणली.'));
    });
});

describe('H-1: a sent invitation someone else opened', () => {
    it('takes the owner to that person\'s own request card', async () => {
        listInvitations.mockResolvedValue([{
            id: 'inv-1', farmId: 'farm-1', code: '48217730', link: 'https://shramsafal.in/i/48217730', label: 'CoOwner',
            name: 'रमेश', invitedPhoneLast4: '2345', fieldOperatorId: null, plotScope: 'AllPlots', plotIds: [], plotNames: [],
            authorities: [], status: 'Accepted', createdAtUtc: '2026-11-06T06:00:00Z', expiresAtUtc: '2026-11-13T06:00:00Z',
            claimedByUserId: 'suresh', claimedAtUtc: '2026-11-06T07:00:00Z', waitsForOwner: true, workerLinked: false,
            claimedByName: 'Suresh', claimedByPhoneLast4: '4321', claimedByAnotherNumber: true, claimOutcome: 'WaitsForOwner',
        }]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('sent-open-request-inv-1'));
        const requestCard = screen.getByTestId('join-request-suresh');
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        expect(document.activeElement).toBe(requestCard);
        expect(screen.getByTestId('join-request-phone-suresh').textContent).toContain('4321');
    });
});
