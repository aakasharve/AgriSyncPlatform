// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, slice S5.3) - the owner's "सेटिंग बदला" on the saved screen opens माझी टीम:
 * the hub takes the once-read key (`hub_open_tab = team`) on opening and shows the team page; the key is gone after (a later visit opens the hub
 * menu as before).
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
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
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({ useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }) }));
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
vi.mock('../../labour/data/fieldOperatorClient', () => ({ fetchFieldOperators: vi.fn().mockResolvedValue([]), createFieldOperator: vi.fn(), deactivateFieldOperator: vi.fn() }));
vi.mock('../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { cleanup, render, screen } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';
import { HUB_OPEN_TAB_KEY, requestOpenTeamSetting } from '../../recordAudience/teamSettingLink';

const profile = {
    name: 'मी', village: 'पिंपळगाव', phone: '8888888888', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified,
    operators: [], waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;
const mountHub = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={[]} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeEach(() => {
    window.sessionStorage.clear();
    h.fetchLabourPermissions.mockResolvedValue([]);
    h.getMyFarms.mockResolvedValue([{ farmId: 'farm-a', name: 'farm-a', role: 'PrimaryOwner', farmCode: 'K7M2QP', subscription: null, status: 'Active' }]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PERM S5.3 - the owner\'s सेटिंग बदला opens माझी टीम', () => {
    it('the hub opens on its team page when asked, once', async () => {
        const asked = vi.fn();
        window.addEventListener('agrisync:open-team-setting', asked);
        requestOpenTeamSetting('money');
        expect(asked).toHaveBeenCalledTimes(1);
        window.removeEventListener('agrisync:open-team-setting', asked);
        mountHub();
        expect(await screen.findByTestId('hub-page-team')).toBeInTheDocument();
        expect(window.sessionStorage.getItem(HUB_OPEN_TAB_KEY)).toBeNull();
        cleanup();
        mountHub();
        expect(await screen.findByTestId('hub-team')).toBeInTheDocument(); // the hub menu, as before
        expect(screen.queryByTestId('hub-page-team')).toBeNull();
    });
});
