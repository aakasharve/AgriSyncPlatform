// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5) — the real "सेट-अप केंद्र" in the
 * approved look: one Marathi title and back, every real row still reachable and wired, one truth
 * about verification, an honest setup count (the soil step that cannot be done is "लवकरच", not a
 * step), and the hub pages still save through `onUpdateProfile`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ logout: vi.fn(), setLanguage: vi.fn(), waiting: [] as unknown[], voice: [] as unknown[] }));

// plr-d10 (I17): the offline-notes row is drawn only while a note waits for review.
vi.mock('../../../infrastructure/sync/PendingAiResultsReader', () => ({
    listUnreviewedAiResults: () => Promise.resolve(h.waiting),
}));
// lane OF (D-59): the recordings not saved yet — THE one reader (the gear, this row, the page).
vi.mock('../../../infrastructure/sync/waitingVoiceNotes', async (orig) => ({
    ...(await orig<typeof import('../../../infrastructure/sync/waitingVoiceNotes')>()),
    listWaitingVoiceNotes: () => Promise.resolve(h.voice),
}));

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: h.setLanguage, t: (k: string) => k }),
    useOptionalLanguage: () => null,
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'u1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: h.logout }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../core/session/FarmContext', () => ({
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
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';
import { __resetBackStackForTests, dismissTopOverlay } from '../../../core/navigation/backStack';

const baseProfile = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...over,
});

const handlers = () => ({
    onUpdateProfile: vi.fn(), onUpdateCrops: vi.fn(), onOpenScheduleLibrary: vi.fn(), onOpenFinanceManager: vi.fn(),
    onOpenLabour: vi.fn(), onOpenConsent: vi.fn(),
    onOpenAiDrafts: vi.fn(), onOpenSettings: vi.fn(), onOpenVoiceDiary: vi.fn(), onExit: vi.fn(),
});

const mount = (profile = baseProfile(), hs = handlers()) => {
    render(<TestProviders><ProfilePage profile={profile} crops={[]} {...hs} /></TestProviders>);
    return hs;
};

describe('ProfilePage — the redesigned सेट-अप केंद्र', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks(); h.waiting = []; __resetBackStackForTests(); });

    it('reads सेट-अप केंद्र with one back, and lists every setup page in plain Marathi', () => {
        const hs = mount();
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
        expect(screen.queryByText(/Profile/)).toBeNull();
        const farm = screen.getByTestId('hub-farm');
        for (const title of ['माझी ओळख', 'पिकं आणि प्लॉट', 'पाणी आणि वीज', 'यंत्रं', 'माती व पाणी अहवाल']) {
            expect(within(farm).getByText(title)).toBeInTheDocument();
        }
        expect(screen.getByTestId('hub-row-health')).toHaveTextContent('लवकरच');
        fireEvent.click(screen.getByTestId('page-back'));
        expect(hs.onExit).toHaveBeenCalledTimes(1);
    });

    it('a filled name + village is not called "verified"; a government-verified identity is', () => {
        mount();
        expect(screen.queryByTestId('hub-verified')).toBeNull();
        expect(screen.queryByText(/Verified/)).toBeNull();
        cleanup();
        mount(baseProfile({ verificationStatus: VerificationStatus.GovernmentVerified }));
        expect(screen.getByTestId('hub-verified')).toHaveTextContent('ओळख पडताळलेली');
    });

    it('counts only the steps that can be done (4) and "पुढचं" opens the next one; back returns to the hub', () => {
        mount();
        expect(screen.getByTestId('hub-progress')).toHaveTextContent('4 पैकी 1 पूर्ण');
        fireEvent.click(screen.getByTestId('hub-next'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('पिकं आणि प्लॉट');
        expect(screen.getByTestId('hub-page-structure')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('page-back'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
    });

    it('keeps every other row reachable and wired: money, labour, recordings, privacy, logout', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-finance'));
        fireEvent.click(screen.getByTestId('hub-labour'));
        fireEvent.click(screen.getByTestId('hub-settings-voice-diary'));
        fireEvent.click(screen.getByTestId('hub-settings-consent'));
        fireEvent.click(screen.getByTestId('hub-logout'));
        for (const fn of [hs.onOpenFinanceManager, hs.onOpenLabour, hs.onOpenVoiceDiary, hs.onOpenConsent, h.logout]) {
            expect(fn).toHaveBeenCalledTimes(1);
        }
        expect(screen.getByTestId('hub-labour')).toHaveTextContent('मजुरी');
    });

    // spec: plr-d10 (I17, PLR-D9 O4 / §6 line 100 + 106)
    it('Referrals is out of the farmer\'s hub, and privacy is ONE row (copy and erase live inside it)', () => {
        mount();
        expect(screen.queryByTestId('hub-referrals')).toBeNull();
        expect(screen.queryByText('रेफरल्स')).toBeNull();
        expect(screen.queryByTestId('hub-settings-export')).toBeNull();
        expect(screen.queryByTestId('hub-settings-erase')).toBeNull();
        const app = screen.getByTestId('hub-app');
        expect(within(app).getByTestId('hub-settings-consent')).toHaveTextContent('गोपनीयता व संमती');
        expect(within(app).getByTestId('hub-settings-consent')).toHaveTextContent('परवानग्या · माझा डेटा');
        // the recordings row and its page carry one name
        expect(within(app).getByTestId('hub-settings-voice-diary')).toHaveTextContent('आवाज नोंदी');
        expect(app.textContent ?? '').not.toMatch(/[A-Za-z]{3,}/);
    });

    it('the offline-notes row is hidden while nothing waits for review', async () => {
        mount();
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByTestId('hub-settings-ai-drafts')).toBeNull();
    });

    it('lane OF (D-59): the offline-notes row counts only the bill photo; the voice recording waits in आवाज नोंदी with its number', async () => {
        h.waiting = [{ id: 1, operationType: 'voice_parse' }, { id: 2, operationType: 'receipt_extract' }];
        h.voice = [{ jobId: 1, state: 'understood', spokenAtUtc: '2026-10-31T10:00:00.000Z', job: { id: 1 } }];
        const hs = mount();
        // the waiting lists are read from the phone after the first paint: slow on a busy machine
        const row = await screen.findByTestId('hub-settings-ai-drafts', {}, { timeout: 20_000 });
        expect(row).toHaveTextContent('नेट नसताना केलेल्या नोंदी');
        expect(row).not.toHaveTextContent('आवाज नोंदी');
        expect(row).toHaveTextContent('1');
        expect(row).not.toHaveTextContent('2');
        expect(row.textContent ?? '').not.toMatch(/[A-Za-z]/);
        const voice = await screen.findByTestId('voice-notes-row-count', {}, { timeout: 20_000 });
        expect(voice).toHaveTextContent('1');
        expect(screen.getByTestId('hub-settings-voice-diary')).toHaveTextContent('1 नोंद समजली — बघून जतन करा');
        fireEvent.click(row);
        expect(hs.onOpenAiDrafts).toHaveBeenCalledTimes(1);
        h.voice = [];
    }, 60_000);

    it('lane OF (D-59): a recording not understood yet says so on the आवाज नोंदी row; a bill photo alone is not counted there', async () => {
        h.waiting = [{ id: 2, operationType: 'receipt_extract' }];
        h.voice = [
            { jobId: 3, state: 'pending', spokenAtUtc: '2026-10-31T10:00:00.000Z', job: { id: 3 } },
            { jobId: 4, state: 'working', spokenAtUtc: '2026-10-31T10:05:00.000Z', job: { id: 4 } },
        ];
        mount();
        const voice = await screen.findByTestId('voice-notes-row-count', {}, { timeout: 20_000 });
        expect(voice).toHaveTextContent('2');
        expect(screen.getByTestId('hub-settings-voice-diary')).toHaveTextContent('2 नोंदी अजून समजलेल्या नाहीत');
        h.voice = [];
    }, 60_000);

    it('the phone\'s own Back on a hub page returns to the hub, like the page\'s मागे', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-open-machines'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('यंत्रं');
        let closed = false;
        act(() => { closed = dismissTopOverlay(); });
        expect(closed).toBe(true);
        expect(screen.getByTestId('page-title')).toHaveTextContent('सेट-अप केंद्र');
        expect(hs.onExit).not.toHaveBeenCalled();
        // on the hub itself nothing is left to close: Back then belongs to the app's route history
        expect(dismissTopOverlay()).toBe(false);
    });

    it('the "?" on a row opens its plain guide', () => {
        mount();
        fireEvent.click(screen.getByTestId('hub-help-utils'));
        expect(screen.getByTestId('hub-row-utils')).toHaveTextContent('काय करायचं');
    });

    it('the language page sets the language', () => {
        mount();
        fireEvent.click(screen.getByTestId('hub-settings-language'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('भाषा');
        fireEvent.click(screen.getByTestId('lang-en'));
        expect(h.setLanguage).toHaveBeenCalledWith('en');
    });

    it('पाणी आणि वीज saves a new source through onUpdateProfile and says it is on this phone only', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-open-utils'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('पाणी आणि वीज');
        expect(screen.getByTestId('setup-this-phone-only')).toBeInTheDocument();
        expect(screen.getByTestId('phase-threePhase')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('source-add'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'विहीर' } });
        fireEvent.click(screen.getByTestId('source-next'));
        fireEvent.change(screen.getByTestId('motor-name-1'), { target: { value: 'पंप' } });
        fireEvent.click(screen.getByTestId('source-save'));
        expect(hs.onUpdateProfile).toHaveBeenCalledTimes(1);
        const next = hs.onUpdateProfile.mock.calls[0][0] as FarmerProfile;
        expect(next.waterResources[0]).toMatchObject({ name: 'विहीर', type: 'Well' });
        expect(next.motors[0]).toMatchObject({ name: 'पंप', linkedWaterSourceId: next.waterResources[0].id });
        expect(next.name).toBe('Purvesh Arve');
    });

    it('यंत्रं saves a new machine through onUpdateProfile', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-open-machines'));
        fireEvent.click(screen.getByTestId('machine-add'));
        fireEvent.change(screen.getByTestId('machine-name'), { target: { value: 'ट्रॅक्टर' } });
        fireEvent.click(screen.getByTestId('machine-save'));
        expect((hs.onUpdateProfile.mock.calls[0][0] as FarmerProfile).machineries?.[0]).toMatchObject({ name: 'ट्रॅक्टर', type: 'Tractor', ownership: 'Owned' });
    });

    it('the soil page has no pretend upload — it says plainly it is not built', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-open-health'));
        const page = screen.getByTestId('hub-page-health');
        expect(page).toHaveTextContent('लवकरच');
        expect(within(page).queryByText(/Upload/i)).toBeNull();
        expect(within(page).queryByText(/Soil Test/i)).toBeNull();
        // the only button on the page is the back button
        expect(within(page).getAllByRole('button')).toHaveLength(1);
        expect(hs.onUpdateProfile).not.toHaveBeenCalled();
    });

    it('the identity page is still reachable under the new title bar', () => {
        mount();
        fireEvent.click(screen.getByTestId('hub-open-identity'));
        expect(screen.getByTestId('page-title')).toHaveTextContent('माझी ओळख');
        expect(screen.getByTestId('hub-page-identity')).toHaveTextContent('Purvesh Arve');
    });
});
