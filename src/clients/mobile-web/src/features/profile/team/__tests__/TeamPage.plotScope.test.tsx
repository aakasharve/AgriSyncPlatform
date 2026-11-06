// @vitest-environment jsdom
/**
 * spec: plr-d10 lane MU-4 (MU design §2 "Scope", §6; orchestrator call 8) — the PRIMARY owner chooses which plots one
 * person covers, on the "माझी टीम" screen, over the REAL roster hook and the farm's real plots (a fake-indexeddb Dexie):
 *   - a let-in person's card carries ONE row, "प्लॉट: सर्व प्लॉट ›"; it opens the three choices; निवडलेले प्लॉट lists the
 *     farm's plots to tick, cannot be kept with none ticked, and sends exactly the ticked plots; the card then shows the
 *     row the SERVER returned (never its own guess);
 *   - a joining request carries the same row; approving without touching it starts from the preset (कामगार → स्वतःचं
 *     काम, काम + हजेरी → सर्व प्लॉट); a choice made in the card is sent with the approval;
 *   - no plot row on the registrant, on yourself, or for a caller who is not the primary owner; none from a server that
 *     sends no plot scope.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';

const fetchLabourPermissions = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
    setLabourPermission: vi.fn(),
}));

const approveMember = vi.fn();
const setMemberPlotScope = vi.fn();
vi.mock('../../data/membershipAdminClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/membershipAdminClient')>()),
    approveMember: (...a: unknown[]) => approveMember(...a),
    setMemberPlotScope: (...a: unknown[]) => setMemberPlotScope(...a),
}));

vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
// spec: plr-d10 lane MU-2 — the team page now lists the invitations the owner sent: stubbed, so this suite stays
// off the network (an empty list draws nothing).
vi.mock('../../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../../invitations/personalInvitationClient')>()),
    listInvitations: vi.fn(async () => []),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const FARM = 'farm-1';
const P1 = 'plot-1';
const P2 = 'plot-2';
const P4 = 'plot-4';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], plotScope: 'AllPlots', ...over,
});

const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
const RAMESH = row({ userId: 'ramesh', role: 'Mukadam', displayName: 'रमेश', joinedVia: 'QrScan' });
const REQUEST = row({ userId: 'sunil', status: 'PendingApproval', displayName: 'सुनील', joinedVia: 'SelfJoin', plotScope: undefined });

const Harness: React.FC<{ role?: string; userId?: string }> = ({ role = 'PrimaryOwner', userId = 'me' }) => {
    const roster = useLabourPermissions(role === 'PrimaryOwner' || role === 'SecondaryOwner' ? FARM : null);
    return <TeamPage farmId={FARM} farmCode="K7M2QP" callerRole={role} callerUserId={userId} roster={roster} onShowQr={vi.fn()} />;
};

beforeEach(async () => {
    fetchLabourPermissions.mockReset();
    approveMember.mockReset();
    setMemberPlotScope.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, RAMESH, REQUEST]);
    const db = getDatabase();
    await db.plots.clear();
    for (const [id, name] of [[P1, 'प्लॉट एक'], [P2, 'प्लॉट दोन'], [P4, 'प्लॉट चार']]) {
        await db.plots.put({ id, farmId: FARM, payload: { id, farmId: FARM, name }, updatedAt: '2026-11-02T00:00:00Z' });
    }
});
afterEach(cleanup);

describe('the plot row on a let-in person\'s card', () => {
    it('reads "प्लॉट: सर्व प्लॉट", opens the three choices, and sends exactly the ticked plots', async () => {
        setMemberPlotScope.mockResolvedValue({ ...RAMESH, plotScope: 'ChosenPlots', plotIds: [P2, P4] });
        render(<Harness />);
        const card = await screen.findByTestId('team-person-ramesh');
        expect(within(card).getByTestId('plot-scope-row-ramesh').textContent).toContain('प्लॉट: सर्व प्लॉट');

        fireEvent.click(within(card).getByTestId('plot-scope-row-ramesh'));
        const sheet = within(card).getByTestId('plot-scope-sheet-ramesh');
        for (const word of ['सर्व प्लॉट', 'निवडलेले प्लॉट', 'स्वतःचं काम']) expect(within(sheet).getByText(word)).toBeTruthy();
        expect(sheet.textContent).not.toMatch(/AI|एआय/);

        fireEvent.click(within(sheet).getByTestId('plot-scope-choice-ChosenPlots-ramesh'));
        await within(sheet).findByTestId(`plot-scope-plot-${P2}-ramesh`);
        expect((within(sheet).getByTestId('plot-scope-save-ramesh') as HTMLButtonElement).disabled).toBe(true);
        expect(within(sheet).getByTestId('plot-scope-pick-one-ramesh').textContent).toBe('किमान एक प्लॉट निवडा.');

        fireEvent.click(within(sheet).getByTestId(`plot-scope-plot-${P4}-ramesh`));
        fireEvent.click(within(sheet).getByTestId(`plot-scope-plot-${P2}-ramesh`));
        fireEvent.click(within(sheet).getByTestId('plot-scope-save-ramesh'));

        await waitFor(() => expect(setMemberPlotScope).toHaveBeenCalledTimes(1));
        const [farmId, userId, body] = setMemberPlotScope.mock.calls[0];
        expect(farmId).toBe(FARM);
        expect(userId).toBe('ramesh');
        expect(body.plotScope).toBe('ChosenPlots');
        expect([...body.plotIds].sort()).toEqual([P2, P4].sort());
        // The SERVER's row is shown: his plots by name.
        await waitFor(() => expect(screen.getByTestId('plot-scope-summary-ramesh').textContent).toBe('प्लॉट चार, प्लॉट दोन'));
    });

    it('स्वतःचं काम is one tap and sends no plots', async () => {
        setMemberPlotScope.mockResolvedValue({ ...RAMESH, plotScope: 'OwnWork' });
        render(<Harness />);
        const card = await screen.findByTestId('team-person-ramesh');
        fireEvent.click(within(card).getByTestId('plot-scope-row-ramesh'));
        fireEvent.click(within(card).getByTestId('plot-scope-choice-OwnWork-ramesh'));
        fireEvent.click(within(card).getByTestId('plot-scope-save-ramesh'));
        await waitFor(() => expect(setMemberPlotScope).toHaveBeenCalledWith(FARM, 'ramesh', { plotScope: 'OwnWork' }));
        await waitFor(() => expect(screen.getByTestId('plot-scope-summary-ramesh').textContent).toBe('स्वतःचं काम'));
    });

    it('is never drawn on the registrant, on yourself, for a non-owner caller, or from a server without plot scopes', async () => {
        render(<Harness />);
        await screen.findByTestId('team-person-ramesh');
        expect(screen.queryByTestId('plot-scope-row-me')).toBeNull();
        cleanup();

        render(<Harness role="Mukadam" userId="ramesh" />);
        await waitFor(() => expect(screen.queryByTestId('plot-scope-row-ramesh')).toBeNull());
        cleanup();

        fetchLabourPermissions.mockResolvedValue([OWNER, { ...RAMESH, plotScope: undefined }]);
        render(<Harness />);
        await screen.findByTestId('team-person-ramesh');
        expect(screen.queryByTestId('plot-scope-row-ramesh')).toBeNull();
    });
});

describe('the plot row on a joining request', () => {
    it('starts from the preset: काम सांगणे approves as स्वतःचं काम, काम + हजेरी as सर्व प्लॉट', async () => {
        approveMember.mockResolvedValue({ ...REQUEST, status: 'Active', plotScope: 'OwnWork' });
        render(<Harness />);
        const card = await screen.findByTestId('join-request-sunil');
        expect(within(card).getByTestId('plot-scope-row-sunil').textContent).toContain('काम सांगणे: स्वतःचं काम');
        fireEvent.click(within(card).getByTestId('approve-work-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledTimes(1));
        expect(approveMember.mock.calls[0][2]).toEqual({ role: 'Worker', grantLabour: false, plotScope: 'OwnWork' });
    });

    it('काम + हजेरी starts from every plot', async () => {
        approveMember.mockResolvedValue({ ...REQUEST, status: 'Active', role: 'Mukadam' });
        render(<Harness />);
        const card = await screen.findByTestId('join-request-sunil');
        fireEvent.click(within(card).getByTestId('approve-crew-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledTimes(1));
        expect(approveMember.mock.calls[0][2]).toEqual({ role: 'Mukadam', grantLabour: true, plotScope: 'AllPlots' });
    });

    it('a choice made in the card rides the approval', async () => {
        approveMember.mockResolvedValue({ ...REQUEST, status: 'Active', role: 'Mukadam', plotScope: 'ChosenPlots', plotIds: [P1] });
        render(<Harness />);
        const card = await screen.findByTestId('join-request-sunil');
        fireEvent.click(within(card).getByTestId('plot-scope-row-sunil'));
        fireEvent.click(within(card).getByTestId('plot-scope-choice-ChosenPlots-sunil'));
        fireEvent.click(await within(card).findByTestId(`plot-scope-plot-${P1}-sunil`));
        fireEvent.click(within(card).getByTestId('plot-scope-save-sunil'));
        expect(within(card).getByTestId('plot-scope-summary-sunil').textContent).toBe('प्लॉट एक');
        fireEvent.click(within(card).getByTestId('approve-crew-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledTimes(1));
        expect(approveMember.mock.calls[0][2]).toEqual({ role: 'Mukadam', grantLabour: true, plotScope: 'ChosenPlots', plotIds: [P1] });
    });
});

describe('lane MU-4 fix pass 2 (N7): a joining request never reads "सर्व प्लॉट" for what a कामगार would get as his own work', () => {
    it('choosing every plot on the request keeps the preset line: काम सांगणे is his own work, काम + हजेरी every plot', async () => {
        render(<Harness />);
        const card = await screen.findByTestId('join-request-sunil');
        fireEvent.click(within(card).getByTestId('plot-scope-row-sunil'));
        fireEvent.click(within(card).getByTestId('plot-scope-choice-AllPlots-sunil'));
        fireEvent.click(within(card).getByTestId('plot-scope-save-sunil'));
        const summary = within(card).getByTestId('plot-scope-summary-sunil').textContent ?? '';
        expect(summary).not.toBe('सर्व प्लॉट');
        expect(summary).toContain('काम सांगणे: स्वतःचं काम');
    });
});
