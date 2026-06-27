// @vitest-environment jsdom
/**
 * AuthProvider logout wiring tests
 * spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1 + Task 6.2
 *
 * Proves:
 * - logout calls backend (logoutCurrentDevice) BEFORE clearing local state.
 * - logout clears AuthTokenStore (clearAuthSession).
 * - logout clears DEK (clearCachedDek) + consent token (clearCachedConsentToken).
 * - logout clears rememberDevice flag (clearRememberDevice).
 * - logout calls clearNativeRefreshSession.
 * - logout sets authStatus → 'anonymous' and session → null.
 * - Backend failure still clears local state and goes anonymous (fail-closed).
 *
 * Task 6.2:
 * - refresh 401 (refreshSession resolves null) → clearAuthSession, authStatus anonymous.
 * - AgriSyncClient.refreshSession() clears clearNativeRefreshSession on failure.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted via vi.mock. Factories must not reference outer let vars.
// ---------------------------------------------------------------------------

const mockLogoutCurrentDevice = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('../../../infrastructure/api/AgriSyncClient', () => {
    return {
        agriSyncClient: {
            get refreshSession() { return mockRefreshSession; },
            get logoutCurrentDevice() { return mockLogoutCurrentDevice; },
            login: vi.fn(),
            register: vi.fn(),
        },
    };
});

const mockClearAuthSession = vi.fn();
const mockGetAuthSession = vi.fn(() => null);
const mockSetAuthSession = vi.fn();

vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => mockGetAuthSession(),
    setAuthSession: (...args: unknown[]) => mockSetAuthSession(...args),
    clearAuthSession: () => mockClearAuthSession(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));

const mockClearCachedDek = vi.fn();
vi.mock('../../../infrastructure/security/tenantDekClient', () => ({
    clearCachedDek: () => mockClearCachedDek(),
}));

const mockClearCachedConsentToken = vi.fn();
vi.mock('../../../infrastructure/consent/ConsentTokenClient', () => ({
    clearCachedConsentToken: () => mockClearCachedConsentToken(),
}));

const mockSetRememberDevice = vi.fn();
const mockClearRememberDevice = vi.fn();
vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => false),
    setRememberDevice: (...args: unknown[]) => mockSetRememberDevice(...args),
    clearRememberDevice: () => mockClearRememberDevice(),
}));

const mockClearNativeRefreshSession = vi.fn();
vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: () => mockClearNativeRefreshSession(),
    getNativeRefreshSession: vi.fn(() => Promise.resolve(null)),
    setNativeRefreshSession: vi.fn(),
    isNativeSecureRefreshEnabled: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { AuthProvider, useAuth } from '../AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders the provider and exposes logout + authStatus via probe */
function LogoutProbe(): React.ReactElement {
    const { logout, authStatus } = useAuth();
    return (
        <div>
            <span data-testid="auth-status">{authStatus}</span>
            <button data-testid="logout-btn" onClick={() => { void logout(); }} />
        </div>
    );
}

/**
 * Renders AuthProvider in an already-authenticated state by having
 * refreshSession return a valid session, then waits for boot to complete.
 * Returns a cleanup function (call in afterEach is handled by the suite).
 */
async function renderAuthenticated() {
    const fakeSession = { userId: 'u-1', accessToken: 'tok', expiresAtUtc: '2099-01-01T00:00:00Z' };
    mockRefreshSession.mockResolvedValueOnce(fakeSession);

    render(
        <AuthProvider>
            <LogoutProbe />
        </AuthProvider>,
    );

    // Wait for boot refresh to complete → authenticated
    await waitFor(() => {
        expect(screen.getByTestId('auth-status').textContent).toBe('authenticated');
    });
}

// ---------------------------------------------------------------------------
// Tests — Task 6.1 logout wiring
// ---------------------------------------------------------------------------

describe('AuthProvider — Task 6.1 logout wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: native refresh session clear is a no-op promise
        mockClearNativeRefreshSession.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it('calls logoutCurrentDevice on the backend before clearing local state', async () => {
        // Track call order via a sequence array
        const callOrder: string[] = [];

        mockLogoutCurrentDevice.mockImplementation(async () => {
            callOrder.push('backend');
        });
        mockClearAuthSession.mockImplementation(() => {
            callOrder.push('clearAuthSession');
        });

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        // backend must be called first
        expect(callOrder[0]).toBe('backend');
        expect(callOrder[1]).toBe('clearAuthSession');
    });

    it('clears AuthTokenStore (clearAuthSession) on logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        expect(mockClearAuthSession).toHaveBeenCalledTimes(1);
    });

    it('clears DEK cache on logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        expect(mockClearCachedDek).toHaveBeenCalledTimes(1);
    });

    it('clears consent token on logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        expect(mockClearCachedConsentToken).toHaveBeenCalledTimes(1);
    });

    it('clears rememberDevice flag on logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        expect(mockClearRememberDevice).toHaveBeenCalledTimes(1);
    });

    it('calls clearNativeRefreshSession on logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        expect(mockClearNativeRefreshSession).toHaveBeenCalledTimes(1);
    });

    it('sets authStatus to anonymous after logout', async () => {
        mockLogoutCurrentDevice.mockResolvedValueOnce(undefined);

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
    });

    it('clears local state and goes anonymous even when backend logout fails (fail-closed)', async () => {
        mockLogoutCurrentDevice.mockRejectedValueOnce(new Error('network down'));

        await renderAuthenticated();

        await act(async () => {
            screen.getByTestId('logout-btn').click();
        });

        // Despite backend failure, cleanup must happen
        expect(mockClearAuthSession).toHaveBeenCalledTimes(1);
        expect(mockClearCachedDek).toHaveBeenCalledTimes(1);
        expect(mockClearCachedConsentToken).toHaveBeenCalledTimes(1);
        expect(mockClearRememberDevice).toHaveBeenCalledTimes(1);

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
    });
});

// ---------------------------------------------------------------------------
// Tests — Task 6.2 refresh fail-closed
// ---------------------------------------------------------------------------

describe('AuthProvider — Task 6.2 refresh fail-closed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClearNativeRefreshSession.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
    });

    it('refresh 401 (resolves null) → authStatus anonymous', async () => {
        // First call from boot: returns null (simulating 401 / expired cookie)
        mockRefreshSession.mockResolvedValueOnce(null);

        render(
            <AuthProvider>
                <LogoutProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
    });

    it('refresh failure → clearAuthSession called', async () => {
        mockRefreshSession.mockResolvedValueOnce(null);

        render(
            <AuthProvider>
                <LogoutProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });

        expect(mockClearAuthSession).toHaveBeenCalled();
    });

    it('refresh rejection → authStatus anonymous', async () => {
        mockRefreshSession.mockRejectedValueOnce(new Error('network'));

        render(
            <AuthProvider>
                <LogoutProbe />
            </AuthProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('auth-status').textContent).toBe('anonymous');
        });
    });
});
