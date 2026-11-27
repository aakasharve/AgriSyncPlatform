// @vitest-environment jsdom
/**
 * Repair FIX-1 item 10 (R2-B 15 with the founder's changes, 27 Nov) — the माझी टीम step of the first setup.
 * While the farm open in the app has only its owner on the team list and no invitation sent, the step is a card: the question
 * "तुमच्यासोबत शेतीचं काम कोण पाहतं?" and three big choices (कुटुंबातील सदस्य · कामगार · मुकादम) that open the EXISTING invite sheet
 * with that label chosen. Adding one person is a MUST: the step is a red "बाकी", counted by "पुढचं" — and it never blocks anything.
 * "सध्या मी एकटाच शेती पाहतो" clears it for THIS farm (kept on this phone, per farm). A person added or an invitation sent: the
 * normal row, पूर्ण. No "विश्वास" on the card.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    language: 'mr' as 'mr' | 'en',
    farmId: 'farm-1',
    prefs: {} as Record<string, unknown>,
    rows: [] as unknown[],
    invitations: [] as unknown[],
}));

vi.mock('../../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [value, setValue] = R.useState<T>(() => (key in h.prefs ? (h.prefs[key] as T) : fallback));
            R.useEffect(() => { setValue(key in h.prefs ? (h.prefs[key] as T) : fallback); }, [key, fallback]);
            return [value, (next: T) => { h.prefs[key] = next; setValue(next); }, true] as const;
        },
    };
});
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
    useFarmContext: () => ({ currentFarmId: h.farmId, switchFarm: vi.fn(), farms: [], isLoading: false }),
    useOptionalFarmContext: () => ({ currentFarmId: h.farmId, switchFarm: vi.fn(), farms: [], isLoading: false }),
    FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../features/work/hooks/useWorkerProfile', () => ({
    useWorkerProfile: () => ({ profile: null, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: vi.fn().mockResolvedValue([
        { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'K7M2QP', subscription: null, status: 'Active' },
        { farmId: 'farm-3', name: 'Navi Farm', role: 'PrimaryOwner', farmCode: 'N3W5RT', subscription: null, status: 'Active' },
    ]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../data/labourPermissionsClient')>()),
    fetchLabourPermissions: vi.fn(async () => h.rows),
}));
vi.mock('../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../invitations/personalInvitationClient')>()),
    listInvitations: vi.fn(async () => h.invitations),
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

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
// pilot lane IDENT: the person's own card comes from the server; here a complete one (identity step done, as the name + village did
// before), and no network.
vi.mock('../../identity/identityApi', async () => (await import('../../identity/__tests__/identityApiStub')).identityApiStub());
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type CropProfile, type FarmerProfile } from '../../../domain/types/farm.types';

const NO_CUT = { patternMode: 'FIXED_WEEKLY' as const, alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] };
/** Every step before माझी टीम is done, so "पुढचं" should reach the team step next. */
const profile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: 'w1', type: 'Well', name: 'विहीर', isAvailable: true }],
    motors: [{ id: 'm1', name: 'पंप', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'w1' }],
    electricityTiming: { singlePhase: NO_CUT, threePhase: NO_CUT, savedByFarmerAt: '2026-11-27T10:00:00.000Z' },
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;
const crops = [{ id: 'c1', name: 'Grapes', plots: [] }] as unknown as CropProfile[];

const person = (userId: string, role: string, over: Record<string, unknown> = {}) => ({
    userId, role, status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false, source: 'NotGranted',
    isGrantEditable: true, labourGrantExpiresAtUtc: null, displayName: userId, permissions: [], ...over,
});
const OWNER = person('owner-1', 'PrimaryOwner', { isRegistrant: true, isGrantEditable: false, source: 'OwnerTier' });

const mount = () => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={crops} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onOpenLabour={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeEach(() => { h.language = 'mr'; h.farmId = 'farm-1'; h.prefs = {}; h.rows = [OWNER]; h.invitations = []; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('सेट-अप केंद्र — the माझी टीम step of the first setup', () => {
    it('owner alone, nothing sent: the question card shows, the step is a red बाकी, and "पुढचं" reaches it', async () => {
        mount();
        const card = await screen.findByTestId('hub-team-first');
        expect(card).toHaveTextContent('तुमच्यासोबत शेतीचं काम कोण पाहतं?');
        for (const word of ['कुटुंबातील सदस्य', 'कामगार', 'मुकादम']) expect(within(card).getByRole('button', { name: word })).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: 'सध्या मी एकटाच शेती पाहतो' })).toBeInTheDocument();
        const badge = within(card).getByTestId('hub-team-status');
        expect(badge).toHaveTextContent('बाकी');
        expect(badge.className).toContain('rose');
        expect(screen.getByTestId('hub-next')).toHaveTextContent('पुढचं: माझी टीम');
        expect(card.textContent).not.toMatch(/विश्वास/);
        // it never blocks: every other step still opens
        fireEvent.click(screen.getByTestId('hub-open-machines'));
        expect(screen.getByTestId('hub-page-machines')).toBeInTheDocument();
    });

    it('one more person on the team: no card, the step reads पूर्ण', async () => {
        h.rows = [OWNER, person('ramesh', 'Worker')];
        mount();
        const row = await screen.findByTestId('hub-team');
        await within(row).findByText('पूर्ण');
        expect(screen.queryByTestId('hub-team-first')).toBeNull();
    });

    it('one invitation sent: no card, the step reads पूर्ण', async () => {
        h.invitations = [{ id: 'i1', farmId: 'farm-1', label: 'Worker', status: 'Waiting' }];
        mount();
        const row = await screen.findByTestId('hub-team');
        await within(row).findByText('पूर्ण');
        expect(screen.queryByTestId('hub-team-first')).toBeNull();
    });

    it('"सध्या मी एकटाच शेती पाहतो": no red mark, it survives a reload, and it is for THIS farm only', async () => {
        mount();
        fireEvent.click(within(await screen.findByTestId('hub-team-first')).getByRole('button', { name: 'सध्या मी एकटाच शेती पाहतो' }));
        const row = await screen.findByTestId('hub-team');
        expect(row).toHaveTextContent('पूर्ण');
        expect(screen.queryByTestId('hub-team-first')).toBeNull();
        cleanup();

        mount(); // the app opened again (until the team list is read, the row says nothing either way)
        await within(await screen.findByTestId('hub-team')).findByText('पूर्ण');
        expect(screen.queryByTestId('hub-team-first')).toBeNull();
        expect(screen.queryByTestId('hub-team-status')).toBeNull();
        cleanup();

        h.farmId = 'farm-3'; // another farm of his: still asked there
        mount();
        expect(await screen.findByTestId('hub-team-first')).toBeInTheDocument();
    });

    it('tapping मुकादम opens the existing invite sheet with मुकादम chosen', async () => {
        mount();
        fireEvent.click(within(await screen.findByTestId('hub-team-first')).getByRole('button', { name: 'मुकादम' }));
        expect(screen.getByTestId('invite-builder')).toBeInTheDocument();
        expect(screen.getByTestId('invite-label-Mukadam')).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByTestId('invite-label-Worker')).toHaveAttribute('aria-checked', 'false');
    });

    it('English mode: the English twins', async () => {
        h.language = 'en';
        mount();
        const card = await screen.findByTestId('hub-team-first');
        expect(card).toHaveTextContent('Who looks after the farm work with you?');
        for (const word of ['Family member', 'Worker', 'Mukadam', 'For now I run the farm alone']) {
            expect(within(card).getByRole('button', { name: word })).toBeInTheDocument();
        }
    });
});
