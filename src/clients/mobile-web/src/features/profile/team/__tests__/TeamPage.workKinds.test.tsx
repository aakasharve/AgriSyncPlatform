// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S4.5; founder 27 Nov "a canonical setting in the setup hub, not on the
 * log page") - the farm's registrant chooses, on each person's card in माझी टीम, the kinds of work that person may record: one row
 * "काय नोंदवू शकतात: सर्व कामं ›" opening six ticks (पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च). The WHOLE set is sent (PUT …/work-kinds) and the
 * card shows the row the SERVER returns, never its own guess. None ticked cannot be kept. Observations and reminders are always open (said).
 * A change applies to new records only (founder 1-B, said under the ticks). No row on the registrant, on yourself, or for anyone but the registrant.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const fetchLabourPermissions = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
    setLabourPermission: vi.fn(),
}));
const put = vi.fn();
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { http: { put: (...a: unknown[]) => put(...a), get: vi.fn(), post: vi.fn() } } }));
vi.mock('../../../labour/data/fieldOperatorClient', () => ({ fetchFieldOperators: vi.fn().mockResolvedValue([]), createFieldOperator: vi.fn(), deactivateFieldOperator: vi.fn() }));
vi.mock('../../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../../invitations/personalInvitationClient')>()),
    listInvitations: vi.fn(async () => []),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const FARM = 'farm-1';
const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], plotScope: 'AllPlots', ...over,
});
const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
const RAMESH = row({ userId: 'ramesh', role: 'Worker', displayName: 'रमेश', joinedVia: 'QrScan' });

const Harness: React.FC<{ role?: string; userId?: string }> = ({ role = 'PrimaryOwner', userId = 'me' }) => {
    const roster = useLabourPermissions(role === 'PrimaryOwner' ? FARM : null);
    return <TeamPage farmId={FARM} farmCode="K7M2QP" callerRole={role} callerUserId={userId} roster={roster} onShowQr={vi.fn()} />;
};

beforeEach(() => {
    fetchLabourPermissions.mockReset();
    put.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, RAMESH]);
});
afterEach(cleanup);

describe('PERM S4.5 - "काय नोंदवू शकतात" on a person\'s card', () => {
    it('ticking all six sends all six and the card reads सर्व कामं', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, { ...RAMESH, workKinds: ['irrigation', 'inputs'] }]);
        put.mockResolvedValue({ data: { ...RAMESH } }); // the server stores "every kind" and leaves the key out
        render(<Harness />);
        const card = await screen.findByTestId('team-person-ramesh');
        expect(within(card).getByTestId('work-kinds-row-ramesh').textContent).toBe('काय नोंदवू शकतात: पाणी, औषध / खत');
        fireEvent.click(within(card).getByTestId('work-kinds-row-ramesh'));
        const sheet = within(card).getByTestId('work-kinds-sheet-ramesh');
        expect(sheet.textContent).toContain('निरीक्षण आणि आठवणी नेहमी नोंदवता येतात.');
        expect(sheet.textContent).toContain('बदल फक्त यापुढच्या नोंदींना लागू. आधीच्या नोंदी आहेत तशाच राहतील.');
        for (const k of ['cropActivities', 'labour', 'machinery', 'activityExpenses']) fireEvent.click(within(sheet).getByTestId(`work-kind-${k}-ramesh`));
        fireEvent.click(within(sheet).getByTestId('work-kinds-save-ramesh'));
        await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
        expect(put.mock.calls[0][0]).toBe('/shramsafal/farms/farm-1/memberships/ramesh/work-kinds');
        expect(put.mock.calls[0][1]).toEqual({ workKinds: ['cropActivities', 'irrigation', 'inputs', 'labour', 'machinery', 'activityExpenses'] });
        await waitFor(() => expect(within(screen.getByTestId('team-person-ramesh')).getByTestId('work-kinds-row-ramesh').textContent).toBe('काय नोंदवू शकतात: सर्व कामं'));
    });

    it('none ticked cannot be kept; the card shows what the server returned', async () => {
        put.mockResolvedValue({ data: { ...RAMESH, workKinds: ['irrigation'] } });
        render(<Harness />);
        const card = await screen.findByTestId('team-person-ramesh');
        expect(within(card).getByTestId('work-kinds-row-ramesh').textContent).toBe('काय नोंदवू शकतात: सर्व कामं');
        fireEvent.click(within(card).getByTestId('work-kinds-row-ramesh'));
        const sheet = within(card).getByTestId('work-kinds-sheet-ramesh');
        for (const k of ['cropActivities', 'irrigation', 'inputs', 'labour', 'machinery', 'activityExpenses']) fireEvent.click(within(sheet).getByTestId(`work-kind-${k}-ramesh`));
        expect((within(sheet).getByTestId('work-kinds-save-ramesh') as HTMLButtonElement).disabled).toBe(true);
        expect(within(sheet).getByTestId('work-kinds-pick-one-ramesh').textContent).toBe('किमान एक काम निवडा. एखाद्याचं काम थांबवायचं असेल तर "काम थांबवा" वापरा.');
        fireEvent.click(within(sheet).getByTestId('work-kind-irrigation-ramesh'));
        fireEvent.click(within(sheet).getByTestId('work-kinds-save-ramesh'));
        await waitFor(() => expect(put.mock.calls[0][1]).toEqual({ workKinds: ['irrigation'] }));
        await waitFor(() => expect(within(screen.getByTestId('team-person-ramesh')).getByTestId('work-kinds-row-ramesh').textContent).toBe('काय नोंदवू शकतात: पाणी'));
    });

    it('the row is drawn for the registrant only: never on the registrant, on himself, or for a caller who is not the registrant', async () => {
        render(<Harness />);
        await screen.findByTestId('team-person-ramesh');
        expect(within(screen.getByTestId('team-person-me')).queryByTestId('work-kinds-row-me')).toBeNull();
        cleanup();
        // a PrimaryOwner seat that is not the farm's registrant
        fetchLabourPermissions.mockResolvedValue([{ ...OWNER, isRegistrant: false }, RAMESH, row({ userId: 'boss', role: 'PrimaryOwner', isRegistrant: true })]);
        render(<Harness />);
        await screen.findByTestId('team-person-ramesh');
        expect(screen.queryByTestId('work-kinds-row-ramesh')).toBeNull();
    });
});
