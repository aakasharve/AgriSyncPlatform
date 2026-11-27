// @vitest-environment jsdom
/**
 * Repair FIX-2 (founder 27 Nov) - the सेट-अप केंद्र on a phone of a person on two farms (the FIX-1 drive: मुकादम on farm A with
 * टोमॅटो and 6 plots, owner of farm B). On farm B the hub said "१ पिकं · ७ प्लॉट · ७ प्लॉट बाकी" and counted "पिकं आणि प्लॉट" as done
 * because of farm A's crop. The hub counts the crops it is handed, which are now the open-farm read layer's (`useAppData().crops`).
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

import { cleanup, render, screen, within } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub());
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type CropProfile, type FarmerProfile, type Plot } from '../../../domain/types/farm.types';
import { cropsOnFarm, openFarmOf } from '../../../app/helpers/openFarmView';
import type { PlotFarmIndex } from '../../sync/plots/plotFarmIndex';

const A = 'farm-a';
const B = 'farm-b';
const profile = {
    name: 'मी', village: 'पिंपळगाव', phone: '8888888888', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const plot = (id: string): Plot => ({ id, name: id.toUpperCase(), baseline: { totalArea: 1, unit: 'Acre' } } as Plot);
const A_PLOTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const TOMATO: CropProfile = { id: 'crop_tomato', name: 'टोमॅटो', iconName: 'Sprout', color: 'bg-emerald-500', plots: A_PLOTS.map(plot), supportedTasks: [], workflow: [] };
const DRIVE: PlotFarmIndex = { plotFarm: new Map(A_PLOTS.map(id => [id, A])), farmIds: new Set([A, B]), farmOwner: new Map([[A, 'u-owner-a'], [B, 'u-me']]) };
const shownOn = (farmId: string) => cropsOnFarm([TOMATO], openFarmOf(farmId, DRIVE), DRIVE);

const farm = (farmId: string, role: string) => ({ farmId, name: farmId, role, farmCode: 'K7M2QP', subscription: null, status: 'Active' });
const page = (crops: CropProfile[]) => (
    <TestProviders>
        <ProfilePage profile={profile} crops={crops}
            onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>
);

beforeEach(() => { h.fetchLabourPermissions.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('सेट-अप केंद्र - "पिकं आणि प्लॉट" counts the open farm only', () => {
    it('farm A: one crop, six plots, done; the switch to farm B (nothing of its own yet): "पिकं आणि प्लॉट जोडा", not done', async () => {
        h.getMyFarms.mockResolvedValue([farm(A, 'Mukadam'), farm(B, 'PrimaryOwner')]);
        const { rerender } = render(page(shownOn(A)));
        const onA = await screen.findByTestId('hub-row-structure');
        expect(onA).toHaveTextContent('१ पिकं · ६ प्लॉट');
        expect(within(onA).getByText('पूर्ण')).toBeInTheDocument();

        rerender(page(shownOn(B)));
        const onB = screen.getByTestId('hub-row-structure');
        expect(onB).toHaveTextContent('पिकं आणि प्लॉट जोडा');
        expect(onB).not.toHaveTextContent('प्लॉट बाकी');
        expect(within(onB).queryByText('पूर्ण')).toBeNull();
    });
});
