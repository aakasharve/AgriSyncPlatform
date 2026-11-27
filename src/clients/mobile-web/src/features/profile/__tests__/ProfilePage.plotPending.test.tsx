// @vitest-environment jsdom
/**
 * Repair FIX-1 item 5 (R2-A 10): the hub's पिकं आणि प्लॉट line counts the plots still missing a required link (the same rule as the
 * page's red marks and बाकी list), so the farmer sees it without opening the page.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ choices: new Map<string, unknown>() }));
vi.mock('../../scheduler/schedulePage/usePlotScheduleChoices', () => ({ usePlotScheduleChoices: () => state.choices }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr' }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ session: { userId: 'u1', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }, isAuthenticated: true, logout: vi.fn() }),
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
    getMyFarms: vi.fn().mockResolvedValue([]),
    getFarmDetails: vi.fn().mockResolvedValue(null),
    updateFarmBoundary: vi.fn().mockResolvedValue(undefined),
    probeFarmWeather: vi.fn().mockResolvedValue({ ok: false, providerConfigured: false }),
}));
vi.mock('../../../features/context/components/PlotMap', () => ({ PlotMap: () => null }));
vi.mock('../../../features/admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../../features/onboarding/qr/FarmInviteQrSheet', () => ({ default: () => null }));
vi.mock('../../../features/people/components/MembershipsList', () => ({ default: () => null }));

import { cleanup, render, screen } from '@testing-library/react';
import ProfilePage from '../ProfilePage';
import { TestProviders } from '../../../shared/test/TestProviders';
import { setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, TEMPLATE_ID } from '../../scheduler/schedulePage/__tests__/scheduleFixtures';
import { VerificationStatus, type CropProfile, type FarmerProfile, type Plot } from '../../../domain/types/farm.types';

const profile = {
    name: 'Purvesh Arve', village: 'Pimpalgaon', phone: '8888888888', language: 'mr',
    verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [], motors: [], infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as unknown as FarmerProfile;

const MAPPED = { geoData: { calculatedAreaAcres: 1 } as Plot['geoData'] };
const crop = (unmapped: string[]): CropProfile => ({
    id: 'c1', name: 'Grapes', iconName: 'Grape', color: 'bg-purple-500', activeScheduleId: TEMPLATE_ID,
    supportedTasks: ['General'], workflow: [], createdAt: '2026-01-01',
    plots: Array.from({ length: 6 }, (_, i) => ({
        id: `g${i + 1}`, name: `G${i + 1}`, variety: '', startDate: '2026-01-01', createdAt: '2026-01-01',
        baseline: { totalArea: 2, unit: 'Acre' }, ...(unmapped.includes(`g${i + 1}`) ? {} : MAPPED),
    } as Plot)),
} as CropProfile);

const mount = (crops: CropProfile[]) => render(
    <TestProviders>
        <ProfilePage profile={profile} crops={crops} onUpdateProfile={vi.fn()} onUpdateCrops={vi.fn()} onExit={vi.fn()} />
    </TestProviders>,
);

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE]));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('सेट-अप केंद्र — the पिकं आणि प्लॉट line counts pending plots', () => {
    it('6 plots, 2 without a boundary: the hub says २ प्लॉट बाकी', () => {
        mount([crop(['g2', 'g5'])]);
        expect(screen.getByTestId('hub-row-structure')).toHaveTextContent('१ पिकं · ६ प्लॉट · २ प्लॉट बाकी');
    });

    it('all done: no pending count on the line', () => {
        mount([crop([])]);
        const row = screen.getByTestId('hub-row-structure');
        expect(row).toHaveTextContent('१ पिकं · ६ प्लॉट');
        expect(row).not.toHaveTextContent('बाकी ·');
        expect(row.textContent).not.toMatch(/प्लॉट बाकी/);
    });
});
