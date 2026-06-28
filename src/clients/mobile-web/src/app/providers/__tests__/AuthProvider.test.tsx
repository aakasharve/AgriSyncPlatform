// @vitest-environment jsdom
/**
 * AuthProvider boot-validation tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - Provider starts in 'checking' authStatus.
 * - Successful refreshSession() → 'authenticated'.
 * - Failed refreshSession() → 'anonymous'.
 * - AppFrame does not render LoginPage while authStatus === 'checking'.
 * - FIX #2 regression: AUTH_SESSION_CHANGED_EVENT (OTP/QR-join path) flips
 *   authStatus to 'authenticated' when the new session is non-null, and back
 *   to 'anonymous' when cleared.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted to top, factory must not reference outer vars.
// We use a module-level spy object instead.
// ---------------------------------------------------------------------------

// We will control refreshSession from tests via the spy below.
// vi.mock factory uses a closure over the module, not over local vars.
vi.mock('../../../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login: vi.fn(),
            register: vi.fn(),
            _spy: spy,
        },
    };
});

vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: vi.fn(() => null),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));

vi.mock('../../../infrastructure/security/tenantDekClient', () => ({
    clearCachedDek: vi.fn(),
}));

vi.mock('../../../infrastructure/consent/ConsentTokenClient', () => ({
    clearCachedConsentToken: vi.fn(),
}));

vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => false),
    setRememberDevice: vi.fn(),
    clearRememberDevice: vi.fn(),
}));

vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: vi.fn(() => Promise.resolve()),
    getNativeRefreshSession: vi.fn(() => Promise.resolve(null)),
    setNativeRefreshSession: vi.fn(),
    isNativeSecureRefreshEnabled: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '../AuthProvider';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusProbe(): React.ReactElement {
    const { authStatus, isAuthenticated } = useAuth();
    return (
        <div>
            <span data-testid="auth-status">{authStatus}</span>
            <span data-testid="is-authenticated">{isAuthenticated ? 'yes' : 'no'}</span>
        </div>
    );
}

// Simulate what AppFrame does: show LoginPage only when anonymous, splash when checking.
function AppFrameStub(): React.ReactElement {
    const { authStatus, isAuthenticated } = useAuth();
    if (authStatus === 'checking') {
        return <div data-testid="splash">SplashScreen</div>;
    }
    if (isAuthenticated) {
        return <div data-testid="app-content">AppContent</div>;
    }
    return <div data-testid="login-page">LoginPage</div>;
}

// Helper to get the underlying spy
function getRefreshSpy(): ReturnType<typeof vi.fn> {
    // Access the spy stored in the mock factory via the _spy property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (agriSyncClient as any)._spy as ReturnType<typeof vi.fn>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthProvider — boot-validation state machine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('starts in checking state before refresh resolves', () => {
        let resolveFn!: (v: null) => void;
        getRefreshSpy().mockReturnValueOnce(new Promise<null>(r => { resolveFn = r; }));

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        expect(screen.getByTestId('auth-status').textContent).toBe('checking');
        resolveFn(null);
    });

    it('transitions to authenticated when refreshSession resolves with a session', async () => {
        const fakeSession = {
            userId: 'u-1',
            accessToken: 'tok-abc',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        getRefreshSpy().mockResolvedValueOnce(fakeSession);

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        expect(screen.getByTestId('auth-status').textContent).toBe('checking');

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
        });
        expect(screen.getByTestId('is-authenticated').textContent).toBe('yes');
    });

    it('transitions to anonymous when refreshSession resolves with null', async () => {
        getRefreshSpy().mockResolvedValueOnce(null);

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
        expect(screen.getByTestId('is-authenticated').textContent).toBe('no');
    });

    it('transitions to anonymous when refreshSession rejects', async () => {
        getRefreshSpy().mockRejectedValueOnce(new Error('network error'));

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
    });

    it('AppFrame does not render LoginPage while auth is checking', async () => {
        let resolveFn!: (v: null) => void;
        getRefreshSpy().mockReturnValueOnce(new Promise<null>(r => { resolveFn = r; }));

        render(
            <AuthProvider>
                <AppFrameStub />
            </AuthProvider>,
        );

        // During checking: splash shown, login page NOT rendered
        expect(screen.getByTestId('splash')).toBeInTheDocument();
        expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
        expect(screen.queryByTestId('app-content')).not.toBeInTheDocument();

        // Resolve with null → anonymous → login page appears
        await act(async () => {
            resolveFn(null);
        });
        await waitFor(() => {
            expect(screen.getByTestId('login-page')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('splash')).not.toBeInTheDocument();
    });

    it('AppFrame renders AppContent after successful refresh', async () => {
        const fakeSession = {
            userId: 'u-2',
            accessToken: 'tok-xyz',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        getRefreshSpy().mockResolvedValueOnce(fakeSession);

        render(
            <AuthProvider>
                <AppFrameStub />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('app-content')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });
});

// ---------------------------------------------------------------------------
// FIX #2 regression — OTP/QR-join: AUTH_SESSION_CHANGED_EVENT must flip authStatus
// ---------------------------------------------------------------------------
// spec: secure-remembered-device-sessions-2026-06-24
//
// Root cause before fix: syncFromStorage() called by onAuthSessionChanged only
// updated `session` state but never touched `authStatus`. So after a successful
// OTP login the user remained on LoginPage (authStatus stayed 'anonymous').
//
// Fix: syncFromStorage() (and onAuthSessionChanged) must derive authStatus from
// getAuthSession() — non-null → 'authenticated', null → 'anonymous'.
describe('AuthProvider — FIX #2: AUTH_SESSION_CHANGED_EVENT flips authStatus', () => {
    const AUTH_EVENT = 'agrisync:auth-session-changed';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('isAuthenticated flips to true when AUTH_SESSION_CHANGED_EVENT fires with a non-null session', async () => {
        // Boot: refresh fails → anonymous
        getRefreshSpy().mockResolvedValueOnce(null);
        const mockGetAuthSession = getAuthSession as ReturnType<typeof vi.fn>;
        mockGetAuthSession.mockReturnValue(null);

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
        expect(screen.getByTestId('is-authenticated').textContent).toBe('no');

        // Simulate OTP login success: setAuthSession stores a session and fires the event.
        const fakeSession = {
            userId: 'u-otp',
            accessToken: 'tok-otp',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        mockGetAuthSession.mockReturnValue(fakeSession);

        await act(async () => {
            window.dispatchEvent(new Event(AUTH_EVENT));
        });

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
        });
        expect(screen.getByTestId('is-authenticated').textContent).toBe('yes');
    });

    it('isAuthenticated flips to false when AUTH_SESSION_CHANGED_EVENT fires with null session (logout)', async () => {
        // Boot: refresh succeeds → authenticated
        const fakeSession = {
            userId: 'u-3',
            accessToken: 'tok-3',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        getRefreshSpy().mockResolvedValueOnce(fakeSession);
        const mockGetAuthSession = getAuthSession as ReturnType<typeof vi.fn>;
        mockGetAuthSession.mockReturnValue(fakeSession);

        render(
            <AuthProvider>
                <StatusProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
        });

        // Simulate clearAuthSession — fires the event with null session
        mockGetAuthSession.mockReturnValue(null);

        await act(async () => {
            window.dispatchEvent(new Event(AUTH_EVENT));
        });

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
        expect(screen.getByTestId('is-authenticated').textContent).toBe('no');
    });
});
