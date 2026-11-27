// @vitest-environment jsdom
/**
 * Repair FIX-1 item 3 (R2-A 08 + section J, founder 27 Nov): the hub's order is the founder's —
 * माझी ओळख → पाण्याचे स्रोत → मोटर → वीज आणि वेळापत्रक → पिकं आणि प्लॉट → माझी टीम → यंत्रं →
 * माती व पाणी अहवाल. Water, motor and power stay ONE page but show as three steps, each with its own
 * पूर्ण / बाकी from what is really saved. "पुढचं" follows the order.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getMyFarms: vi.fn(), fetchLabourPermissions: vi.fn(), cardComplete: true }));

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
    useOptionalFarmContext: () => ({ currentFarmId: 'farm-1', switchFarm: vi.fn(), farms: [], isLoading: false }),
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

import { waitFor, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => {
    const { stubCard } = await import('../../identity/__tests__/identityApiStub');
    const answer = () => ({ kind: 'ok' as const, card: stubCard({ complete: h.cardComplete }) });
    return { getMyIdentity: async () => answer(), putMyIdentity: async () => answer() };
});
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type CropProfile, type FarmerProfile } from '../../../domain/types/farm.types';

const OWNER_FARM = { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'K7M2QP', subscription: null, status: 'Active' };
const NO_CUT = { patternMode: 'FIXED_WEEKLY' as const, alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] };

/** A fresh phone: nothing set up. The power timetable is the app's starting default, never saved. */
const empty = (): FarmerProfile => ({
    name: '', village: '', phone: '', language: 'mr',
    verificationStatus: VerificationStatus.Unverified, operators: [],
    waterResources: [], motors: [], machineries: [],
    electricityTiming: { singlePhase: NO_CUT, threePhase: NO_CUT, updatedAt: '2026-11-27T00:00:00.000Z' },
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile);

const SOURCE = { id: 'w1', type: 'Well', name: 'विहीर', isAvailable: true };
const MOTOR = { id: 'm1', name: 'पंप', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'w1' };
const CROP = [{ id: 'c1', name: 'द्राक्ष', plots: [] }] as unknown as CropProfile[];

const page = (profile: FarmerProfile, crops: CropProfile[] = [], onUpdateProfile = vi.fn()) => (
    <TestProviders>
        <ProfilePage profile={profile} crops={crops} onUpdateProfile={onUpdateProfile} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>
);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const rowTitles = () => Array.from(screen.getByTestId('hub-farm').querySelectorAll('[data-testid^="hub-row-"], [data-testid="hub-team"]'))
    .map(el => el.getAttribute('data-testid'));

describe('सेट-अप केंद्र — the founder\'s order', () => {
    it('rows come in the founder\'s order, माझी टीम inside the sequence', async () => {
        h.getMyFarms.mockResolvedValue([OWNER_FARM]);
        h.fetchLabourPermissions.mockResolvedValue([]);
        render(page(empty()));
        await screen.findByTestId('hub-team');
        expect(rowTitles()).toEqual([
            'hub-row-identity', 'hub-row-water', 'hub-row-motor', 'hub-row-power',
            'hub-row-structure', 'hub-team', 'hub-row-machines', 'hub-row-health',
        ]);
        const farm = screen.getByTestId('hub-farm');
        for (const title of ['माझी ओळख', 'पाण्याचे स्रोत', 'मोटर', 'वीज आणि वेळापत्रक', 'पिकं आणि प्लॉट', 'माझी टीम', 'यंत्रं', 'माती व पाणी अहवाल']) {
            expect(within(farm).getByText(title)).toBeInTheDocument();
        }
        // the team row is no longer in the separate people group
        expect(within(screen.getByTestId('hub-people')).queryByTestId('hub-team')).toBeNull();
    });

    it('with nothing set up, "पुढचं" goes माझी ओळख → पाण्याचे स्रोत → मोटर → वीज आणि वेळापत्रक → पिकं आणि प्लॉट → यंत्रं', async () => {
        h.getMyFarms.mockResolvedValue([]);
        // pilot lane IDENT (P10): माझी ओळख is done only when the SERVER says his card is complete, never from the phone's profile.
        h.cardComplete = false;
        let p = { ...empty(), name: 'Purvesh Arve', village: 'Pimpalgaon' };
        const first = render(page(p));
        const next = () => screen.getByTestId('hub-next').textContent;
        await waitFor(() => expect(screen.getByTestId('id-full-name-input')).toHaveValue('Purvesh Arve'));
        expect(next()).toBe('पुढचं: माझी ओळख');
        first.unmount();
        h.cardComplete = true;
        p = empty();
        const { rerender } = render(page(p));
        await waitFor(() => expect(next()).toBe('पुढचं: पाण्याचे स्रोत'));
        p = { ...p, waterResources: [SOURCE] } as FarmerProfile;
        rerender(page(p));
        expect(next()).toBe('पुढचं: मोटर');
        p = { ...p, motors: [MOTOR] } as FarmerProfile;
        rerender(page(p));
        expect(next()).toBe('पुढचं: वीज आणि वेळापत्रक');
        p = { ...p, electricityTiming: { ...p.electricityTiming!, savedByFarmerAt: '2026-11-27T10:00:00.000Z' } };
        rerender(page(p));
        expect(next()).toBe('पुढचं: पिकं आणि प्लॉट');
        rerender(page(p, CROP));
        expect(next()).toBe('पुढचं: यंत्रं');
        p = { ...p, machineries: [{ id: 'k1', name: 'ट्रॅक्टर', type: 'Tractor', ownership: 'Owned' }] };
        rerender(page(p, CROP));
        expect(screen.queryByTestId('hub-next')).toBeNull();
        expect(screen.getByTestId('hub-all-done')).toBeInTheDocument();
        expect(screen.getByTestId('hub-progress')).toHaveTextContent('6 पैकी 6 पूर्ण');
    });

    it('water, motor and power each say पूर्ण / बाकी from what is really saved', () => {
        h.getMyFarms.mockResolvedValue([]);
        render(page({ ...empty(), waterResources: [SOURCE] } as FarmerProfile));
        expect(screen.getByTestId('hub-row-water')).toHaveTextContent('पूर्ण');
        expect(screen.getByTestId('hub-row-motor')).toHaveTextContent('बाकी');
        // the app's starting timetable was never saved by the farmer: not done
        expect(screen.getByTestId('hub-row-power')).toHaveTextContent('बाकी');
        cleanup();
        // an older phone that saved a power cut before the mark existed still counts as saved
        const withCut = { ...empty(), electricityTiming: { singlePhase: { ...NO_CUT, weekAOffWindows: [{ id: 'x', startTime: '06:00', endTime: '09:00', repeatRule: 'DAILY', days: [] }] }, threePhase: NO_CUT } } as unknown as FarmerProfile;
        render(page(withCut));
        expect(screen.getByTestId('hub-row-power')).toHaveTextContent('पूर्ण');
    });

    it('the three steps open the ONE पाणी आणि वीज page; saving the power times marks them saved', () => {
        h.getMyFarms.mockResolvedValue([]);
        const onUpdateProfile = vi.fn();
        render(page(empty(), [], onUpdateProfile));
        for (const id of ['water', 'motor', 'power']) {
            fireEvent.click(screen.getByTestId(`hub-open-${id}`));
            expect(screen.getByTestId('hub-page-utils')).toBeInTheDocument();
            expect(screen.getByTestId('page-title')).toHaveTextContent('पाणी आणि वीज');
            fireEvent.click(screen.getByTestId('page-back'));
        }
        fireEvent.click(screen.getByTestId('hub-open-power'));
        fireEvent.click(screen.getByTestId('alternate-singlePhase'));
        fireEvent.click(screen.getByTestId('power-save'));
        const saved = onUpdateProfile.mock.calls[0][0] as FarmerProfile;
        expect(saved.electricityTiming?.savedByFarmerAt).toEqual(expect.any(String));
    });
});
