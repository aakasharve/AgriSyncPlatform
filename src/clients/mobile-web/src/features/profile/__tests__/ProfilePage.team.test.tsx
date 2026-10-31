// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, MU-11 / P-4) — in the real सेट-अप केंद्र: the farm's
 * permanent code on the top card, a "माणसं → माझी टीम" row that says how many people wait for the
 * owner's answer, and that row opening the team screen (one title, one back) with the request on it.
 * A worker's hub has no team row and asks the owner-only roster nothing.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getMyFarms: vi.fn(), fetchLabourPermissions: vi.fn() }));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'owner-1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', switchFarm: vi.fn(), farms: [], isLoading: false }),
    FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: (...a: unknown[]) => h.getMyFarms(...a),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => h.fetchLabourPermissions(...a),
}));
vi.mock('../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]), createFieldOperator: vi.fn(), deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const profile: FarmerProfile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const farm = (role: string) => ({ farmId: 'farm-1', name: 'Arve Farm', role, farmCode: 'K7M2QP', subscription: null, status: 'Active' });

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={[]} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ProfilePage — माणसं → माझी टीम', () => {
    it('the owner sees the farm code, a counted team row, and the team screen with the waiting request', async () => {
        h.getMyFarms.mockResolvedValue([farm('PrimaryOwner')]);
        h.fetchLabourPermissions.mockResolvedValue([
            { userId: 'owner-1', role: 'PrimaryOwner', status: 'Active', canManageLabourRecords: true, hasExplicitGrant: false, source: 'OwnerTier', isGrantEditable: false, labourGrantExpiresAtUtc: null, displayName: 'Purvesh', isRegistrant: true, permissions: [] },
            { userId: 'sunil', role: 'Worker', status: 'PendingApproval', canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, displayName: 'सुनील', joinedVia: 'SelfJoin', permissions: [] },
        ]);
        mount();

        expect(await screen.findByTestId('hub-farm-code')).toHaveTextContent('K7M2QP');
        const row = await screen.findByTestId('hub-team');
        expect(await within(row).findByText('1 व्यक्ती आत येऊ इच्छिते')).toBeInTheDocument();
        expect(h.fetchLabourPermissions).toHaveBeenCalledWith('farm-1');

        fireEvent.click(row);
        expect(screen.getByTestId('page-title')).toHaveTextContent('माझी टीम');
        expect(screen.getByTestId('farm-code')).toHaveTextContent('K7M2QP');
        expect(screen.getByText('सुनील आत येऊ इच्छितात')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('page-back'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
    });

    it('a co-owner is not counted waiting requests and gets none to answer (only the primary owner decides — D-22)', async () => {
        h.getMyFarms.mockResolvedValue([farm('SecondaryOwner')]);
        h.fetchLabourPermissions.mockResolvedValue([
            { userId: 'owner-1', role: 'SecondaryOwner', status: 'Active', canManageLabourRecords: true, hasExplicitGrant: false, source: 'OwnerTier', isGrantEditable: false, labourGrantExpiresAtUtc: null, displayName: 'Anita', permissions: [] },
            { userId: 'sunil', role: 'Worker', status: 'PendingApproval', canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, displayName: 'सुनील', joinedVia: 'SelfJoin', permissions: [] },
        ]);
        mount();

        // lane 2b (founder D-26): the roster is people and permissions — the PRIMARY account holder's
        // alone. The server refuses a सहमालक now, so his phone never asks; he looks at the team view-only.
        const row = await screen.findByTestId('hub-team');
        expect(row).not.toHaveTextContent('आत येऊ इच्छि');
        fireEvent.click(row);
        expect(screen.getByTestId('page-title')).toHaveTextContent('माझी टीम');
        expect(await screen.findByTestId('team-view-only')).toBeInTheDocument();
        expect(screen.queryByTestId('team-people')).toBeNull();
        expect(screen.queryByTestId('team-requests')).toBeNull();
        expect(screen.queryByText('सुनील आत येऊ इच्छितात')).toBeNull();
        expect(h.fetchLabourPermissions).not.toHaveBeenCalled();
    });

    it('a मुकादम gets a view-only team row and never asks the owner-only roster', async () => {
        h.getMyFarms.mockResolvedValue([farm('Mukadam')]);
        mount();
        const row = await screen.findByTestId('hub-team');
        expect(row).toHaveTextContent('माझ्या टोळीतले लोक');
        fireEvent.click(row);
        expect(screen.getByTestId('team-view-only')).toBeInTheDocument();
        expect(h.fetchLabourPermissions).not.toHaveBeenCalled();
    });

    it('a worker\'s hub has no team row, still shows his farm\'s code, and never asks the owner-only roster', async () => {
        h.getMyFarms.mockResolvedValue([farm('Worker')]);
        mount();
        expect(await screen.findByTestId('hub-farm-code')).toHaveTextContent('K7M2QP');
        expect(screen.queryByTestId('hub-team')).toBeNull();
        expect(h.fetchLabourPermissions).not.toHaveBeenCalled();
    });
});
