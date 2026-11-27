// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1, Bug 5 (screen 1 of 4): English mode is English only on the सेट-अप केंद्र menu — the progress line,
 * every step row's title, line and guide, the farms row, the team row, and every other row and heading it draws — no
 * Devanagari and Latin digits. Names the person typed or the server sent are the one exception. The पाणी आणि वीज and यंत्रं
 * pages' title bars (drawn here) are English too. Marathi mode stays exactly as it is.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'en' as 'mr' | 'en' }));

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
        { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'K7M2QP', subscription: null, status: 'Active' },
        { farmId: 'farm-2', name: 'Pawar Farm', role: 'Mukadam', farmCode: 'P4W2R9', subscription: null, status: 'Active' },
    ]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../data/labourPermissionsClient')>()),
    fetchLabourPermissions: vi.fn(async () => [
        { userId: 'owner-1', role: 'PrimaryOwner', status: 'Active', canManageLabourRecords: true, hasExplicitGrant: false, source: 'OwnerTier', isGrantEditable: false, labourGrantExpiresAtUtc: null, displayName: 'Purvesh', isRegistrant: true, permissions: [] },
        { userId: 'ramesh', role: 'Worker', status: 'PendingApproval', canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, displayName: 'Ramesh', permissions: [] },
    ]),
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
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub());
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type CropProfile, type FarmerProfile } from '../../../domain/types/farm.types';

const DEVANAGARI = /[ऀ-ॿ]/;
const shownWords = (root: HTMLElement) => [
    root.textContent ?? '',
    ...Array.from(root.querySelectorAll('[placeholder]')).map(el => el.getAttribute('placeholder') ?? ''),
    ...Array.from(root.querySelectorAll('[aria-label]')).map(el => el.getAttribute('aria-label') ?? ''),
].join(' | ');

const NO_CUT = { patternMode: 'FIXED_WEEKLY' as const, alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] };
const profile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'en',
    verificationStatus: VerificationStatus.GovernmentVerified, operators: [],
    waterResources: [{ id: 'w1', type: 'Well', name: 'Main well', isAvailable: true }],
    motors: [],
    electricityTiming: { singlePhase: NO_CUT, threePhase: NO_CUT, savedByFarmerAt: '2026-11-27T10:00:00.000Z' },
    machineries: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;
const crops = [{ id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', activeScheduleId: null,
    plots: [{ id: 'g1', name: 'G1', variety: '', startDate: '2026-01-01', createdAt: '2026-01-01', baseline: { totalArea: 2, unit: 'Acre' } }] }] as unknown as CropProfile[];

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={crops} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()}
            onOpenFinanceManager={vi.fn()} onOpenConsent={vi.fn()} onOpenVoiceDiary={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeEach(() => { h.language = 'en'; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('सेट-अप केंद्र — English mode is English only', () => {
    it('the whole menu: progress, every step row and its guide, the farms row, the team row — no Devanagari, Latin digits', async () => {
        mount();
        const hub = screen.getByTestId('setup-hub');
        await screen.findByTestId('hub-team');
        await screen.findByTestId('hub-farm-code');
        // every "?" guide open as well
        for (const button of Array.from(hub.querySelectorAll('[data-testid^="hub-help-"]'))) fireEvent.click(button);
        await waitFor(() => expect(screen.getByTestId('hub-row-structure')).toHaveTextContent('1 crop · 1 plot · 1 plot pending'));
        expect(screen.getByTestId('hub-progress')).toHaveTextContent(/\d+ of \d+ done/);
        expect(screen.getByTestId('hub-next')).toHaveTextContent('Next: Motor');
        expect(screen.getByTestId('hub-row-water')).toHaveTextContent('1 source');
        expect(shownWords(hub)).not.toMatch(DEVANAGARI);
    });

    it('the पाणी आणि वीज and यंत्रं pages: English title bars', async () => {
        mount();
        fireEvent.click(screen.getByTestId('hub-open-water'));
        expect(shownWords(screen.getByTestId('page-bar'))).not.toMatch(DEVANAGARI);
        expect(screen.getByTestId('page-title')).toHaveTextContent('Water and power');
        fireEvent.click(screen.getByTestId('page-back'));
        fireEvent.click(screen.getByTestId('hub-open-machines'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('Machines');
    });

    it('Marathi mode stays exactly as it is', async () => {
        h.language = 'mr';
        mount();
        await screen.findByTestId('hub-team');
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
        expect(screen.getByTestId('hub-progress')).toHaveTextContent('शेत तयार करणं');
        expect(screen.getByTestId('hub-progress')).toHaveTextContent(/\d+ पैकी \d+ पूर्ण/);
        expect(screen.getByTestId('hub-next')).toHaveTextContent('पुढचं: मोटर');
        expect(screen.getByTestId('hub-row-water')).toHaveTextContent('1 स्रोत');
        expect(screen.getByTestId('hub-row-motor')).toHaveTextContent('स्रोतावरची मोटर');
        expect(screen.getByTestId('hub-row-power')).toHaveTextContent('विजेच्या वेळा जतन झाल्या');
        expect(screen.getByTestId('hub-row-structure')).toHaveTextContent('१ पिकं · १ प्लॉट');
        expect(screen.getByTestId('hub-farms')).toHaveTextContent('तुमच्या शेती');
        expect(screen.getByTestId('hub-logout')).toHaveTextContent('बाहेर पडा');
    });
});
