// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85).
 *
 * The REAL App + AppFrame + AuthProvider + DeviceCheckQuestion (harness as App.firstRunOrder.test.tsx; the answer's
 * network call is the one stub):
 *   - a phone the server holds (boot refresh) gets the question FIRST — no app, no login, nothing stored;
 *   - होय → the app opens with the session the server opened, and the question is gone for good on this phone;
 *   - नाही → the D-85 words, "मागे" → the sign-in screen, still nothing stored;
 *   - his own (known) phone is never asked.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ answer: vi.fn() }));

vi.mock('../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login: vi.fn(),
            register: vi.fn(),
            beginLogout: vi.fn(() => Promise.resolve()),
            completePendingLogout: vi.fn(() => Promise.resolve('none')),
            _spy: spy,
        },
    };
});
vi.mock('../features/auth/data/deviceCheckClient', () => ({ answerDeviceCheck: (...a: unknown[]) => h.answer(...a) }));
vi.mock('../infrastructure/storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn(), notifyFarmerSessionEnded: vi.fn(), onFarmerSessionEnded: vi.fn(() => () => undefined) }));
vi.mock('../infrastructure/security/tenantDekClient', () => ({ clearCachedDek: vi.fn() }));
vi.mock('../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => false), setRememberDevice: vi.fn(), clearRememberDevice: vi.fn(),
}));
vi.mock('../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: vi.fn(() => Promise.resolve()),
}));
vi.mock('../infrastructure/telemetry/ClientErrorReporter', () => ({ installGlobalErrorHandlers: vi.fn() }));
vi.mock('../features/admin/ops/AdminOpsPreview', () => ({ AdminOpsPreview: () => null }));
vi.mock('../features/labour/LabourPreview', () => ({ LabourPreview: () => null }));
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
    SystemBars: {}, SystemBarsStyle: {},
}));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: {}, Style: {} }));
vi.mock('@capgo/capacitor-navigation-bar', () => ({ NavigationBar: {} }));
vi.mock('../app/context/LogContext', () => ({ LogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../app/components/common/AppErrorBoundary', () => ({ AppErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../AppContent', () => ({ default: () => <div data-testid="app-content" /> }));
vi.mock('../i18n/LanguageContext', () => ({
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../shared/components/ui/SplashScreen', () => ({ default: () => null }));
vi.mock('../app/providers/DataSourceProvider', () => ({ DataSourceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../app/context/SelectionContext', () => ({ SelectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../core/session/FarmContext', () => ({ FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/sync', () => ({ OfflineBanner: () => null }));
vi.mock('../infrastructure/storage/AiTestModeStore', () => ({ setAiTestModeEnabled: vi.fn(), clearAiTestMode: vi.fn() }));
vi.mock('../app/components/AppShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/consent/gate/useConsentGateLink', () => ({ useConsentGateLinkReconciliation: vi.fn() }));
vi.mock('../features/consent/reask/NoticeChangeSheet', () => ({ default: () => null }));
vi.mock('../app/featureFlags', () => ({ IS_OVERSIGHT_PREVIEW_ENABLED: false }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock('../pages/JoinFarmLandingPage', () => ({ default: () => <div data-testid="join-landing" /> }));
vi.mock('../features/onboarding/firstRun/FirstRunWelcome', () => ({ default: () => <div data-testid="first-run-welcome" /> }));

import App from '../App';
import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { clearAuthSession, getAuthSession } from '../infrastructure/storage/AuthTokenStore';
import { markFirstRunWelcomeSeen } from '../infrastructure/storage/FirstRunDeviceStore';
import { askDeviceCheck, clearPendingDeviceCheck, getPendingDeviceCheck } from '../infrastructure/storage/PendingDeviceCheckStore';

const spy = () => (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;
const OPENED = { userId: 'u-owner', accessToken: 'opens-the-account', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() };

/** What AgriSyncClient.refreshSession does when the server says the phone has not answered (its own suite proves it). */
const heldBoot = () => spy().mockImplementation(async () => {
    askDeviceCheck({ userId: 'u-owner', accountName: 'रमेश पाटील' });
    return { kind: 'device-check' };
});

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    clearAuthSession();
    clearPendingDeviceCheck();
    markFirstRunWelcomeSeen();
    h.answer.mockReset();
    spy().mockReset().mockResolvedValue({ kind: 'unreachable' });
});
afterEach(cleanup);

describe('App — the one-time new-phone question (D-56)', () => {
    it('a held phone is asked FIRST: no app, no login, nothing stored; होय opens the app and the question is gone', async () => {
        heldBoot();
        h.answer.mockResolvedValue({ kind: 'confirmed', session: OPENED });
        render(<App />);

        expect(await screen.findByTestId('device-check-question'))
            .toHaveTextContent('हे खातं रमेश पाटील यांचं आहे — तुम्ही तेच आहात का?');
        expect(screen.queryByTestId('app-content')).toBeNull();
        expect(screen.queryByTestId('login-page')).toBeNull();
        expect(getAuthSession()).toBeNull();

        fireEvent.click(screen.getByTestId('device-check-yes'));

        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
        expect(screen.queryByTestId('device-check-question')).toBeNull();
        expect(getAuthSession()?.accessToken).toBe('opens-the-account');
        expect(getPendingDeviceCheck()).toBeNull();
    });

    it('नाही: the D-85 words; "मागे" goes to the sign-in screen and nothing is stored', async () => {
        heldBoot();
        h.answer.mockResolvedValue({ kind: 'declined' });
        render(<App />);

        fireEvent.click(await screen.findByTestId('device-check-no'));
        expect(await screen.findByTestId('device-check-declined'))
            .toHaveTextContent('हे खातं तुमचं नाही. नंबर बदलला असेल तर श्रमसफल मदतीशी संपर्क करा.');
        expect(screen.queryByTestId('app-content')).toBeNull();

        fireEvent.click(screen.getByTestId('device-check-back'));
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(getAuthSession()).toBeNull();
        expect(getPendingDeviceCheck()).toBeNull();
    });

    it('his own phone (the server does not hold it) is never asked', async () => {
        spy().mockImplementation(async () => {
            const { setAuthSession } = await import('../infrastructure/storage/AuthTokenStore');
            setAuthSession(OPENED);
            return { kind: 'refreshed', session: OPENED };
        });
        render(<App />);

        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
        expect(screen.queryByTestId('device-check-question')).toBeNull();
        expect(h.answer).not.toHaveBeenCalled();
    });

    it('a question asked by a sign-in while the app is open replaces the login screen at once', async () => {
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());

        // What OtpVerifyForm / AuthProvider.login do with a held sign-in answer (their own suites prove it).
        askDeviceCheck({ userId: 'u-owner', accountName: 'रमेश पाटील' });

        expect(await screen.findByTestId('device-check-question')).toBeInTheDocument();
        expect(screen.queryByTestId('login-page')).toBeNull();
    });
});
