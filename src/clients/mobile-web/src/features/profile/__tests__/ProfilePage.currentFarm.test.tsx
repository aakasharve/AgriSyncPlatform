// @vitest-environment jsdom
/**
 * Repair FIX-1 item 2 (R2-A 03 + 20, founder 27 Nov): the सेट-अप केंद्र follows the farm OPEN in the
 * app (the same farm the header and the switcher use). It used to pick "the first farm I own" once,
 * so after a switch the hub's name and code could belong to another farm than the header showed, and
 * a मुकादम seat could still get the owner's doors.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const listeners = new Set<() => void>();
    const state = {
        currentFarmId: 'farm-1' as string | null,
        listeners,
        getMyFarms: vi.fn(),
        fetchLabourPermissions: vi.fn(),
        switchFarm: (id: string) => { state.currentFarmId = id; listeners.forEach(l => l()); },
    };
    return state;
});

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'owner-1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', async () => {
    const R = await import('react');
    const useCtx = () => {
        const id = R.useSyncExternalStore(
            (l: () => void) => { h.listeners.add(l); return () => { h.listeners.delete(l); }; },
            () => h.currentFarmId,
        );
        return { currentFarmId: id, currentFarm: null, switchFarm: h.switchFarm, farms: [], isLoading: false, meContext: null };
    };
    return {
        useFarmContext: useCtx,
        useOptionalFarmContext: useCtx,
        FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    };
});
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

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type CropProfile, type FarmerProfile } from '../../../domain/types/farm.types';

const profile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const crops = [{ id: 'c1', name: 'द्राक्ष', plots: [] }] as unknown as CropProfile[];

// The owned farm is listed FIRST: the old hub always picked it.
const OWNED = { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'K7M2QP', subscription: null, status: 'Active' };
const CREW = { farmId: 'farm-2', name: 'Pawar Mala', role: 'Mukadam', farmCode: 'P4W2R9', subscription: null, status: 'Active' };

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={crops} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeEach(() => {
    h.getMyFarms.mockResolvedValue([OWNED, CREW]);
    h.fetchLabourPermissions.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); h.currentFarmId = 'farm-1'; h.listeners.clear(); });

describe('सेट-अप केंद्र — the farm open in the app', () => {
    it('after a switch, the hub shows THAT farm\'s name and code', async () => {
        h.currentFarmId = 'farm-1';
        mount();
        expect(await screen.findByTestId('hub-farm-code')).toHaveTextContent('K7M2QP');
        expect(within(screen.getByTestId('hub-me')).getByText('Arve Farm')).toBeInTheDocument();

        act(() => { h.switchFarm('farm-2'); });

        expect(await screen.findByText('P4W2R9')).toBeInTheDocument();
        const me = screen.getByTestId('hub-me');
        expect(within(me).getByText('Pawar Mala')).toBeInTheDocument();
        expect(me).not.toHaveTextContent('Arve Farm');
        expect(me).not.toHaveTextContent('K7M2QP');
    });

    it('opened on a farm where I am not an owner: that farm, and no owner doors', async () => {
        h.currentFarmId = 'farm-2';
        mount();
        expect(await screen.findByText('P4W2R9')).toBeInTheDocument();
        expect(within(screen.getByTestId('hub-me')).getByText('Pawar Mala')).toBeInTheDocument();
        // the मुकादम's team row only LOOKS at his crew; the owner-only roster is never asked
        const row = await screen.findByTestId('hub-team');
        expect(row).toHaveTextContent('माझ्या टोळीतले लोक');
        expect(h.fetchLabourPermissions).not.toHaveBeenCalled();
        // no "add plot" door on this farm — and no "add crop" door either (round 1, Bug 3)
        fireEvent.click(screen.getByTestId('hub-open-structure'));
        expect(screen.queryByTestId('plot-add-c1')).toBeNull();
        expect(screen.queryByText('नवीन पीक जोडा')).toBeNull();
    });

    it('the owned farm, open in the app, keeps its owner doors', async () => {
        h.currentFarmId = 'farm-1';
        mount();
        await screen.findByText('K7M2QP');
        expect(await screen.findByTestId('hub-team')).not.toHaveTextContent('माझ्या टोळीतले लोक');
        expect(h.fetchLabourPermissions).toHaveBeenCalledWith('farm-1');
        fireEvent.click(screen.getByTestId('hub-open-structure'));
        expect(screen.getByTestId('plot-add-c1')).toBeInTheDocument();
        expect(screen.getByText('नवीन पीक जोडा')).toBeInTheDocument();
    });
});
