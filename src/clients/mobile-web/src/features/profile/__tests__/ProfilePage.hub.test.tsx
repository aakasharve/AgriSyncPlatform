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

const h = vi.hoisted(() => ({ logout: vi.fn(), setLanguage: vi.fn() }));

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

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';

const baseProfile = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
    ...over,
});

const handlers = () => ({
    onUpdateProfile: vi.fn(), onUpdateCrops: vi.fn(), onOpenScheduleLibrary: vi.fn(), onOpenFinanceManager: vi.fn(),
    onOpenLabour: vi.fn(), onOpenReferrals: vi.fn(), onOpenConsent: vi.fn(), onOpenExport: vi.fn(), onOpenErasure: vi.fn(),
    onOpenAiDrafts: vi.fn(), onOpenSettings: vi.fn(), onExit: vi.fn(),
});

const mount = (profile = baseProfile(), hs = handlers()) => {
    render(<TestProviders><ProfilePage profile={profile} crops={[]} {...hs} /></TestProviders>);
    return hs;
};

describe('ProfilePage — the redesigned सेट-अप केंद्र', () => {
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

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

    it('keeps every other row reachable and wired: money, labour, referrals, settings, logout', () => {
        const hs = mount();
        fireEvent.click(screen.getByTestId('hub-finance'));
        fireEvent.click(screen.getByTestId('hub-labour'));
        fireEvent.click(screen.getByTestId('hub-referrals'));
        fireEvent.click(screen.getByTestId('hub-settings-voice-diary'));
        fireEvent.click(screen.getByTestId('hub-settings-consent'));
        fireEvent.click(screen.getByTestId('hub-settings-export'));
        fireEvent.click(screen.getByTestId('hub-settings-erase'));
        fireEvent.click(screen.getByTestId('hub-settings-ai-drafts'));
        fireEvent.click(screen.getByTestId('hub-logout'));
        for (const fn of [hs.onOpenFinanceManager, hs.onOpenLabour, hs.onOpenReferrals, hs.onOpenSettings, hs.onOpenConsent, hs.onOpenExport, hs.onOpenErasure, hs.onOpenAiDrafts, h.logout]) {
            expect(fn).toHaveBeenCalledTimes(1);
        }
        expect(screen.getByTestId('hub-labour')).toHaveTextContent('मजुरी');
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
