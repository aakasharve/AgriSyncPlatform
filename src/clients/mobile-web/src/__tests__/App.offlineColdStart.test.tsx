// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * App-level: the REAL App + AppFrame + AuthProvider + AuthTokenStore. Cold start
 * with no network and a surviving presence marker must render the app shell, not
 * LoginPage. Only heavy leaf screens/providers and the network edge are stubbed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login: vi.fn(),
            register: vi.fn(),
            logoutCurrentDevice: vi.fn(() => Promise.resolve()),
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
vi.mock('../pages/LoginPage', () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock('../pages/JoinFarmLandingPage', () => ({ default: () => null }));
vi.mock('../features/consent/gate/ConsentGateScreen', () => ({ default: () => <div data-testid="consent-gate" /> }));
vi.mock('../features/consent/gate/useConsentGate', () => ({
    useConsentGate: () => ({ status: 'passed', preRegistrationSessionId: null, markPassed: vi.fn() }),
}));
vi.mock('../features/consent/gate/consentGateApi', () => ({ recordConsentGateAcceptance: vi.fn() }));
vi.mock('../features/consent/gate/consentGateLinkReconciler', () => ({ rememberConsentGateAcceptanceForLinking: vi.fn() }));
vi.mock('../features/consent/gate/useConsentGateLink', () => ({ useConsentGateLinkReconciliation: vi.fn() }));
vi.mock('../app/featureFlags', () => ({ IS_OVERSIGHT_PREVIEW_ENABLED: false }));

import App from '../App';
import { agriSyncClient } from '../infrastructure/api/AgriSyncClient';
import { clearAuthSession } from '../infrastructure/storage/AuthTokenStore';

const KEY = 'agrisync_auth_session_v1';
const spy = () => (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;

beforeEach(() => {
    window.localStorage.clear();
    clearAuthSession();
    spy().mockReset();
});
afterEach(() => cleanup());

describe('App - offline cold start', () => {
    it('renders the app shell (not LoginPage) when a presence marker survives and the network is down', async () => {
        window.localStorage.setItem(KEY, JSON.stringify({
            userId: 'u-field',
            expiresAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
        }));
        spy().mockResolvedValue({ kind: 'unreachable' });

        render(<App />);

        await waitFor(() => expect(screen.getByTestId('app-content')).toBeInTheDocument());
        expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });

    it('renders LoginPage when there is no marker (unchanged behaviour)', async () => {
        spy().mockResolvedValue({ kind: 'unreachable' });
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();
    });

    it('renders LoginPage when the server rejects the credential', async () => {
        window.localStorage.setItem(KEY, JSON.stringify({
            userId: 'u-field',
            expiresAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
        }));
        spy().mockImplementation(async () => { clearAuthSession(); return { kind: 'rejected' }; });
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
        expect(window.localStorage.getItem(KEY)).toBeNull();
    });
});
