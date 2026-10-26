// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, FR-8). The REAL App + AppFrame +
 * AuthProvider decide the first screen (harness as App.offlineColdStart.test.tsx):
 *   - a signed-out person on a phone that has not seen it gets स्वागत FIRST, then the login;
 *   - the login's "← मागे" brings स्वागत back; a phone that passed it goes straight to the login;
 *   - a scanned QR still goes straight to its own join page; a signed-in person never sees स्वागत.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('../infrastructure/storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn() }));
vi.mock('../infrastructure/security/tenantDekClient', () => ({ clearCachedDek: vi.fn() }));
vi.mock('../infrastructure/consent/ConsentTokenClient', () => ({ clearCachedConsentToken: vi.fn() }));
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
vi.mock('../i18n/LanguageContext', () => ({ LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../shared/components/ui/SplashScreen', () => ({ default: () => null }));
vi.mock('../app/providers/DataSourceProvider', () => ({ DataSourceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../app/context/SelectionContext', () => ({ SelectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../core/session/FarmContext', () => ({ FarmContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/sync', () => ({ OfflineBanner: () => null }));
vi.mock('../infrastructure/storage/AiTestModeStore', () => ({ setAiTestModeEnabled: vi.fn(), clearAiTestMode: vi.fn() }));
vi.mock('../app/components/AppShell', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../features/consent/gate/useConsentGateLink', () => ({ useConsentGateLinkReconciliation: vi.fn() }));
vi.mock('../app/featureFlags', () => ({ IS_OVERSIGHT_PREVIEW_ENABLED: false }));
// The three screens are stubbed to the props App gives them; their content has its own suites.
vi.mock('../pages/LoginPage', () => ({
    default: ({ onBack }: { onBack?: () => void }) => (
        <div data-testid="login-page">{onBack && <button type="button" onClick={onBack}>login-back</button>}</div>
    ),
}));
vi.mock('../pages/JoinFarmLandingPage', () => ({ default: () => <div data-testid="join-landing" /> }));
vi.mock('../features/onboarding/firstRun/FirstRunWelcome', () => ({
    default: ({ onStart }: { onStart: () => void }) => (
        <div data-testid="first-run-welcome"><button type="button" onClick={onStart}>start</button></div>
    ),
}));

import App from '../App';
import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { clearAuthSession } from '../infrastructure/storage/AuthTokenStore';
import { hasSeenFirstRunWelcome, markFirstRunWelcomeSeen } from '../infrastructure/storage/FirstRunDeviceStore';

const spy = () => (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;

beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    clearAuthSession();
    spy().mockReset().mockResolvedValue({ kind: 'unreachable' });
});
afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
});

describe('App — स्वागत is the first screen', () => {
    it('a fresh phone, signed out: स्वागत first (not the login); "सुरू करूया" → the login, remembered on the phone', async () => {
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('first-run-welcome')).toBeInTheDocument());
        expect(screen.queryByTestId('login-page')).toBeNull();

        fireEvent.click(screen.getByText('start'));
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
        expect(hasSeenFirstRunWelcome()).toBe(true);
    });

    it('the login\'s "← मागे" brings स्वागत back, and on again', async () => {
        render(<App />);
        fireEvent.click(await screen.findByText('start'));
        fireEvent.click(screen.getByText('login-back'));
        expect(screen.getByTestId('first-run-welcome')).toBeInTheDocument();
        fireEvent.click(screen.getByText('start'));
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    it('a phone that has passed स्वागत opens on the login', async () => {
        markFirstRunWelcomeSeen();
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(screen.queryByTestId('first-run-welcome')).toBeNull();
    });

    it('a scanned farm QR goes straight to its join page, not round स्वागत', async () => {
        window.history.replaceState(null, '', '/?join=tok&farm=f1');
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('join-landing')).toBeInTheDocument());
        expect(screen.queryByTestId('first-run-welcome')).toBeNull();
    });

    it('a signed-in person never sees स्वागत, even on a phone that has not seen it', async () => {
        window.localStorage.setItem('agrisync_auth_session_v1', JSON.stringify({
            userId: 'u-field',
            expiresAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
        }));
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
        expect(screen.queryByTestId('first-run-welcome')).toBeNull();
    });
});
