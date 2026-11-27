// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1c (founder change, 27 Nov: "Don't show billing
 * card yet for Pilot users this will not be applicable"). On the सेट-अप केंद्र of a PRIMARY OWNER whose farm is on a trial:
 *   - switch OFF (the default): no "बिलिंग" / "तुमचा प्लॅन" row, and the माझी ओळख page draws no trial banner — no gap, no
 *     "coming soon";
 *   - switch ON: the row is back, it opens the बिलिंग card, and the banner shows, as before.
 * Harness as ProfilePage.englishHub.test.tsx, with the REAL banner and card.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));

vi.mock('../../../infrastructure/sync/PendingAiResultsReader', () => ({ listUnreviewedAiResults: () => Promise.resolve([]) }));
vi.mock('../../../infrastructure/sync/waitingVoiceNotes', async (orig) => ({
    ...(await orig<typeof import('../../../infrastructure/sync/waitingVoiceNotes')>()),
    listWaitingVoiceNotes: () => Promise.resolve([]),
}));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'owner-1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', switchFarm: vi.fn(), farms: [], isLoading: false }),
    useOptionalFarmContext: () => ({ currentFarmId: 'farm-1', switchFarm: vi.fn(), farms: [], isLoading: false }),
    FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: vi.fn().mockResolvedValue([
        {
            farmId: 'farm-1', name: 'आर्वे शेती', role: 'PrimaryOwner', farmCode: 'K7M2QP', status: 'Active',
            subscription: {
                statusCode: 1, status: 'Trialing', planCode: 'pro_monthly', allowsOwnerWrites: true,
                validUntilUtc: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
            },
        },
    ]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../data/labourPermissionsClient')>()),
    fetchLabourPermissions: vi.fn(async () => []),
}));
vi.mock('../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../invitations/personalInvitationClient')>()),
    listInvitations: vi.fn(async () => []),
}));
vi.mock('../team/useFarmPlots', () => ({ useFarmPlots: () => [] }));
vi.mock('../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]), createFieldOperator: vi.fn(), deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub());
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const profile = {
    name: 'पुरुषोत्तम आर्वे', village: 'खर्डी', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.GovernmentVerified, operators: [],
    waterResources: [], motors: [], machineries: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={[]} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()}
            onOpenFinanceManager={vi.fn()} onOpenConsent={vi.fn()} onOpenVoiceDiary={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeEach(() => { h.language = 'mr'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); billing.on = false; });

describe('सेट-अप केंद्र — billing hidden unless the switch is on (primary owner on a trial)', () => {
    it('switch OFF: no बिलिंग row and no trial banner', async () => {
        mount();
        // the farm list has answered (the owner's farm-code row is drawn from it)
        await screen.findByTestId('hub-farm-code');
        expect(screen.getByTestId('hub-settings-consent')).toBeInTheDocument();
        expect(screen.queryByTestId('hub-settings-billing')).toBeNull();
        expect(screen.getByTestId('setup-hub').textContent).not.toMatch(/बिलिंग|तुमचा प्लॅन/);
        // pilot lane IDENT (S7): the entitlement banner lives on the farm's own page now.
        fireEvent.click(screen.getByTestId('hub-farm-card-open'));
        expect(await screen.findByTestId('page-title')).toHaveTextContent('शेताची ओळख');
        expect(document.body.textContent).not.toMatch(/Trial active|ट्रायल चालू|days left on your trial/);
    });

    it('switch ON: the row is back and opens the बिलिंग card; the trial banner shows, as before', async () => {
        billing.on = true;
        mount();
        const row = await screen.findByTestId('hub-settings-billing');
        expect(row).toHaveTextContent('बिलिंग');
        expect(row).toHaveTextContent('तुमचा प्लॅन');
        fireEvent.click(screen.getByTestId('hub-farm-card-open'));
        expect(await screen.findByText('Trial active · ट्रायल चालू')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('page-back'));
        fireEvent.click(await screen.findByTestId('hub-settings-billing'));
        expect(await screen.findByTestId('billing-known')).toBeInTheDocument();
    });
});
