// @vitest-environment jsdom
/**
 * Repair FIX-2 (founder 27 Nov) - माझी टीम's view-only list (a मुकादम, a सहमालक) on a phone of a person on two farms names the
 * OPEN farm's people only. The people this phone knows (`farmerProfile.operators`) come from every farm's download (the pull's
 * operators carry no farm); the open farm's share of them is the read layer's (`useAppData().farmPeople`), handed down here.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getMyFarms: vi.fn(), fetchLabourPermissions: vi.fn() }));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'u-me', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-a', switchFarm: vi.fn(), farms: [], isLoading: false }),
    useOptionalFarmContext: () => ({ currentFarmId: 'farm-a', switchFarm: vi.fn(), farms: [], isLoading: false }),
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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub());
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmOperator, type FarmerProfile } from '../../../domain/types/farm.types';

const op = (id: string, name: string, role: FarmOperator['role'] = 'WORKER'): FarmOperator => ({ id, name, role, capabilities: [], isVerifier: false });
const everyone = [op('u-me', 'मी', 'PRIMARY_OWNER'), op('u-owner-a', 'अनिल मालक'), op('u-worker-a', 'गणेश'), op('u-worker-b', 'सुरेश')];
const profile = {
    name: 'मी', village: 'पिंपळगाव', phone: '8888888888', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: everyone, waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;
const farm = (farmId: string, role: string) => ({ farmId, name: farmId, role, farmCode: 'K7M2QP', subscription: null, status: 'Active' });

beforeEach(() => { h.fetchLabourPermissions.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('माझी टीम (view-only, a मुकादम) - the open farm\'s people only', () => {
    it('on farm A he sees A\'s people, never farm B\'s worker', async () => {
        h.getMyFarms.mockResolvedValue([farm('farm-a', 'Mukadam')]);
        const onA = [everyone[0], everyone[1], everyone[2]];
        render(
            <TestProviders>
                <ProfilePage profile={profile} crops={[]} farmPeople={onA}
                    onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
            </TestProviders>,
        );
        fireEvent.click(await screen.findByTestId('hub-team'));
        const list = screen.getByTestId('team-view-only');
        expect(list).toHaveTextContent('अनिल मालक');
        expect(list).toHaveTextContent('गणेश');
        expect(list).not.toHaveTextContent('सुरेश');
    });
});
