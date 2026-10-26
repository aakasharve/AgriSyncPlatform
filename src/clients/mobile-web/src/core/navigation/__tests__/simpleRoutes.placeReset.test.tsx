// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H20; PLR-D9 N3) — tapping सेट-अप केंद्र (or
// the bottom-bar item) he is ALREADY in returns the place to its first screen. ProfilePage keeps the
// open setup page in its own state, so before this the tap did nothing and he stayed on the sub-page.
// Drives the real hook (`useAppNavigation.openPlace`) and the real route table (`SimpleRoutes`) with
// the real setup hub inside it.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'u1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', switchFarm: vi.fn(), farms: [], isLoading: false }),
    FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: vi.fn().mockResolvedValue([]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../../../infrastructure/sync/PendingAiResultsReader', () => ({
    listUnreviewedAiResults: () => Promise.resolve([]),
}));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { SimpleRoutes } from '../simpleRoutes';
import type { AppRouterContext } from '../routeContext';
import { useAppNavigation } from '../../../app/hooks/useAppNavigation';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

// ProfilePage is a lazy route. Its module graph is loaded ONCE in beforeAll (cold, that took ~98 s on a
// loaded machine — longer than any sensible wait), so the waits below measure the reset, not the import.
const SLOW = { timeout: 30_000 };

beforeAll(async () => {
    await import('../../../pages/ProfilePage');
}, 300_000);

const profile: FarmerProfile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
};

describe('re-tapping the place he is in returns it to its first screen', () => {
    afterEach(() => cleanup());

    it('सेट-अप केंद्र tapped while on a setup page shows the hub menu again', async () => {
        const nav = renderHook(() => useAppNavigation());
        act(() => nav.result.current.openPlace('profile'));

        const ctx = () => ({
            currentRoute: nav.result.current.currentRoute,
            setCurrentRoute: nav.result.current.setCurrentRoute,
            goBackOr: nav.result.current.goBackOr,
            farmerProfile: profile, setFarmerProfile: vi.fn(), crops: [], handleUpdateCrops: vi.fn(), history: [],
        }) as unknown as AppRouterContext;
        const draw = () => (
            <React.Suspense fallback={<p>…</p>}>
                <SimpleRoutes ctx={ctx()} resetKey={nav.result.current.placeResetKey} />
            </React.Suspense>
        );

        const view = render(draw());
        fireEvent.click(await screen.findByTestId('hub-open-machines', {}, SLOW));
        expect(screen.getByTestId('page-title')).toHaveTextContent('यंत्रं');

        // the same tap that changed nothing before: the header's सेट-अप केंद्र while already in it
        act(() => nav.result.current.openPlace('profile'));
        view.rerender(draw());

        expect(await screen.findByTestId('setup-hub', {}, SLOW)).toBeInTheDocument();
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
        expect(screen.queryByTestId('hub-page-machines')).toBeNull();
    }, 60_000);

    it('a re-render without a re-tap keeps him on the page he opened', async () => {
        const nav = renderHook(() => useAppNavigation());
        act(() => nav.result.current.openPlace('profile'));
        const ctx = { currentRoute: 'profile', setCurrentRoute: vi.fn(), goBackOr: vi.fn(), farmerProfile: profile, setFarmerProfile: vi.fn(), crops: [], handleUpdateCrops: vi.fn(), history: [] } as unknown as AppRouterContext;
        const view = render(<React.Suspense fallback={null}><SimpleRoutes ctx={ctx} resetKey={nav.result.current.placeResetKey} /></React.Suspense>);
        fireEvent.click(await screen.findByTestId('hub-open-machines', {}, SLOW));
        view.rerender(<React.Suspense fallback={null}><SimpleRoutes ctx={ctx} resetKey={nav.result.current.placeResetKey} /></React.Suspense>);
        expect(screen.getByTestId('page-title')).toHaveTextContent('यंत्रं');
    }, 60_000);
});
