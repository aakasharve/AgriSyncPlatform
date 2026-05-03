// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 1 — ProfilePage baseline smoke/snapshot.
 *
 * Locks observable behavior of the ProfilePage god-file BEFORE the Sub-plan 04
 * Task 6 split into per-tab section components. The snapshot here is intentionally
 * shallow:
 *
 *   - One snapshot, default 'structure' tab.
 *   - Aggressive mocks for the 4 hooks (useLanguage, useAuth, useWorkerProfile,
 *     useFarmContext), the 3 inviteApi network calls (getFarmDetails,
 *     updateFarmBoundary, probeFarmWeather), and the heavyweight subcomponents
 *     that pull in further provider trees (PlotMap, EntitlementBanner,
 *     FarmInviteQrSheet, VocabManager, PeopleDirectory, AddMemberWizard,
 *     MembershipsList, SoilHealthReportsManager, ElectricityTimingConfigurator,
 *     ReliabilityScoreCard, VarietySelector).
 *
 * The snapshot's signal is "ProfilePage mounts and the structure tab surface is
 * present." It is NOT a per-tab regression suite — the original Task 1 plan
 * underestimated ProfilePage's coupling, and per-tab snapshots are deferred to
 * Task 6 where each section becomes a leaf component cheap to snapshot
 * meaningfully. See Sub-plan 04 plan amendment dated 2026-05-01.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';

// ---- Hook mocks (must be hoisted by Vitest before importing ProfilePage) ----
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({
        session: {
            userId: 'test-user',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        },
        isAuthenticated: true,
        isLoading: false,
        authError: null,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
        clearAuthError: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({
        currentFarmId: 'test-farm-id',
        setCurrentFarmId: vi.fn(),
        meContext: null,
        refreshMeContext: vi.fn(),
        farms: [],
        isLoading: false,
    }),
    FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({
        profile: null,
        loading: false,
        error: null,
        refresh: vi.fn(),
    }),
}));

// ---- Network mocks ----
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));

// ---- Heavyweight subcomponent mocks ----
vi.mock('../../../features/context/components/PlotMap', () => ({
    PlotMap: () => <div data-testid="mock-plot-map">[mock PlotMap]</div>,
}));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({
    default: () => <div data-testid="mock-entitlement-banner">[mock EntitlementBanner]</div>,
}));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({
    default: () => <div data-testid="mock-farm-invite-qr">[mock FarmInviteQrSheet]</div>,
}));
vi.mock('../../../features/voice/components/VocabManager', () => ({
    default: () => <div data-testid="mock-vocab-manager">[mock VocabManager]</div>,
}));
vi.mock('../../../features/people/components/PeopleDirectory', () => ({
    default: () => <div data-testid="mock-people-directory">[mock PeopleDirectory]</div>,
}));
vi.mock('../../../features/people/components/AddMemberWizard', () => ({
    AddMemberWizard: () => <div data-testid="mock-add-member-wizard">[mock AddMemberWizard]</div>,
}));
vi.mock('../../../features/people/components/MembershipsList', () => ({
    default: () => <div data-testid="mock-memberships-list">[mock MembershipsList]</div>,
}));
vi.mock('../../../features/profile/components/SoilHealthReportsManager', () => ({
    SoilHealthReportsManager: () => <div data-testid="mock-soil-health">[mock SoilHealthReportsManager]</div>,
}));
vi.mock('../../../features/profile/components/ElectricityTimingConfigurator', () => ({
    default: () => <div data-testid="mock-electricity-timing">[mock ElectricityTimingConfigurator]</div>,
}));
vi.mock('../../../features/work/components/ReliabilityScoreCard', () => ({
    default: () => <div data-testid="mock-reliability-score">[mock ReliabilityScoreCard]</div>,
}));
vi.mock('../../../features/context/components/VarietySelector', () => ({
    VarietySelector: () => <div data-testid="mock-variety-selector">[mock VarietySelector]</div>,
}));

// Imports come AFTER vi.mock so hoisted mocks register first.
import { render } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import {
    type FarmerProfile,
    type CropProfile,
    VerificationStatus,
} from '../../../domain/types/farm.types';

const baselineProfile: FarmerProfile = {
    name: 'Test Farmer',
    village: 'Test Village',
    phone: '9999999999',
    language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified,
    operators: [],
    waterResources: [],
    motors: [],
    infrastructure: {
        waterManagement: 'Centralized',
        filtrationType: 'None',
    },
};

const baselineCrops: CropProfile[] = [];

const noop = () => undefined;

describe('ProfilePage (Sub-plan 04 Task 1 baseline smoke)', () => {
    it('mounts and renders the default structure tab without crashing', () => {
        const { container } = render(
            <TestProviders>
                <ProfilePage
                    profile={baselineProfile}
                    crops={baselineCrops}
                    onUpdateProfile={noop}
                    onUpdateCrops={noop}
                    onAddPerson={noop}
                    onDeletePerson={noop}
                    onOpenScheduleLibrary={noop}
                    onOpenFinanceManager={noop}
                    onOpenReferrals={noop}
                    onOpenQrDemo={noop}
                />
            </TestProviders>
        );
        expect(container.innerHTML).toMatchSnapshot();
    });
});
