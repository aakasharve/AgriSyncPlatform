// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; drawing V2-A; doctrine P10) - the सेट-अप केंद्र of a WORKER on the owner's
 * farm:
 *   - his hub shows HIS name (the server's), never the farm owner's (`profile.name` is the primary owner's: the old card read it);
 *   - "माझी ओळख" is पूर्ण only when the SERVER says his card is complete, never from a name and village held on the phone;
 *   - he sees the farm's card with its code, and no join QR (only the main owner's phone draws it).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ complete: false, issue: vi.fn() }));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'u-raju', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', () => {
    const ctx = {
        currentFarmId: 'farm-1', currentFarm: null, switchFarm: vi.fn(), farms: [], isLoading: false,
        meContext: { me: { userId: 'u-raju', displayName: 'Raju Bhosale', phoneMasked: '******4321', phoneVerifiedAtUtc: '2026-11-01T00:00:00Z', preferredLanguage: 'mr', authMode: 'otp' }, farms: [], share: null, alerts: [], serverTimeUtc: '' },
    };
    return { useFarmContext: () => ctx, useOptionalFarmContext: () => ctx, FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: vi.fn().mockResolvedValue([{ farmId: 'farm-1', name: 'Arve Farm', role: 'Worker', farmCode: 'K7M2QP', subscription: null, status: 'Active' }]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
    issueFarmInvite: (...a: unknown[]) => h.issue(...a),
}));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));
vi.mock('../../identity/identityApi', async () => {
    const { stubCard } = await import('../../identity/__tests__/identityApiStub');
    const answer = () => ({ kind: 'ok' as const, card: stubCard({ userId: 'u-raju', fullName: 'Raju Bhosale', phone: '+919999954321', complete: h.complete }) });
    return { getMyIdentity: async () => answer(), putMyIdentity: async () => answer() };
});

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

// What the phone's profile holds for this farm: the PRIMARY OWNER's name and village (profileAndCropsReconciler).
const ownersProfile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [], waterResources: [], motors: [], machineries: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={ownersProfile} crops={[]} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

afterEach(() => { cleanup(); vi.clearAllMocks(); h.complete = false; });

describe('a worker\'s सेट-अप केंद्र', () => {
    it('shows HIS name, never the farm owner\'s', async () => {
        mount();
        const hub = screen.getByTestId('setup-hub');
        await waitFor(() => expect(hub).toHaveTextContent('Raju Bhosale'));
        expect(hub).not.toHaveTextContent('Purvesh');
    });

    it('"माझी ओळख" is बाकी while the server says his card is not complete, though the phone holds a name and a village', async () => {
        mount();
        await waitFor(() => expect(screen.getByTestId('setup-hub')).toHaveTextContent('Raju Bhosale'));
        expect(screen.getByTestId('hub-row-identity')).toHaveTextContent('बाकी');
        expect(screen.getByTestId('hub-row-identity')).not.toHaveTextContent('पूर्ण');
    });

    it('पूर्ण once the server says his card is complete', async () => {
        h.complete = true;
        mount();
        await waitFor(() => expect(screen.getByTestId('hub-row-identity')).toHaveTextContent('पूर्ण'));
    });

    it('the farm\'s card with its code, his title कामगार, and no join QR (the phone never asks for one)', async () => {
        mount();
        expect(await screen.findByText('K7M2QP')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('my-identity-title')).toHaveTextContent('कामगार'));
        expect(screen.queryByTestId('hub-farm-qr')).toBeNull();
        expect(h.issue).not.toHaveBeenCalled();
    });
});
