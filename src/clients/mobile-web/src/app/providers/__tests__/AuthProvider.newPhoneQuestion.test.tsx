// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85).
 *
 * AuthProvider and the one-time new-phone question:
 *   - the (test-only) password sign-in on a new phone stores NO session and asks (deviceCheck), signed out;
 *   - a boot refresh the server holds ({ kind: 'device-check' }) leaves the app signed out with the question open;
 *   - completeDeviceCheck (होय) stores the session the server opened and signs in; endDeviceCheck (नाही) signs out.
 * Harness as AuthProvider.test.tsx; PendingDeviceCheckStore is the real one.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', () => {
    const spy = vi.fn();
    const login = vi.fn();
    return {
        agriSyncClient: {
            get refreshSession() { return spy; },
            login,
            register: vi.fn(),
            beginLogout: vi.fn(() => Promise.resolve()),
            completePendingLogout: vi.fn(() => Promise.resolve('none')),
            _spy: spy,
        },
    };
});
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: vi.fn(() => null),
    getPresenceSession: vi.fn(() => null),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));
vi.mock('../../../infrastructure/security/tenantDekClient', () => ({ clearCachedDek: vi.fn() }));
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

import { AuthProvider, useAuth } from '../AuthProvider';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { setAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { clearRememberDevice } from '../../../infrastructure/storage/RememberDeviceStore';
import { askDeviceCheck, clearPendingDeviceCheck, getPendingDeviceCheck } from '../../../infrastructure/storage/PendingDeviceCheckStore';

const spy = () => (agriSyncClient as unknown as { _spy: ReturnType<typeof vi.fn> })._spy;
const mockLogin = agriSyncClient.login as unknown as ReturnType<typeof vi.fn>;
const OPENED = { userId: 'u-owner', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z' };

let auth: ReturnType<typeof useAuth> | null = null;
function Probe(): React.ReactElement {
    auth = useAuth();
    return (
        <div>
            <span data-testid="status">{auth.authStatus}</span>
            <span data-testid="question">{auth.deviceCheck ? auth.deviceCheck.accountName : '-'}</span>
        </div>
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    clearPendingDeviceCheck();
    auth = null;
    spy().mockReset().mockResolvedValue({ kind: 'rejected' });
});
afterEach(cleanup);

describe('AuthProvider — the new-phone question', () => {
    it('a held password sign-in stores nothing, stays signed out and opens the question', async () => {
        mockLogin.mockResolvedValue({ ...OPENED, accessToken: 'opens-nothing', deviceCheckRequired: true, accountName: 'चाचणी शेतकरी' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

        await act(async () => { await auth!.login('6000003002', 'pw', true); });

        expect(setAuthSession).not.toHaveBeenCalled();
        expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
        expect(screen.getByTestId('question')).toHaveTextContent('चाचणी शेतकरी');
        expect(auth!.isAuthenticated).toBe(false);
    });

    it('a held boot refresh leaves the app signed out with the question open', async () => {
        spy().mockImplementation(async () => {
            askDeviceCheck({ userId: 'u-owner', accountName: 'रमेश पाटील' });
            return { kind: 'device-check' };
        });
        render(<AuthProvider><Probe /></AuthProvider>);

        await waitFor(() => expect(screen.getByTestId('question')).toHaveTextContent('रमेश पाटील'));
        expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
        expect(setAuthSession).not.toHaveBeenCalled();
    });

    it('होय (completeDeviceCheck) stores the session the server opened and signs in; the question is gone', async () => {
        askDeviceCheck({ userId: 'u-owner', accountName: 'रमेश पाटील' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('question')).toHaveTextContent('रमेश पाटील'));

        act(() => auth!.completeDeviceCheck(OPENED));

        expect(setAuthSession).toHaveBeenCalledWith(OPENED);
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('question')).toHaveTextContent('-');
        expect(getPendingDeviceCheck()).toBeNull();
    });

    it('नाही (endDeviceCheck) signs out and keeps nothing', async () => {
        askDeviceCheck({ userId: 'u-owner', accountName: 'रमेश पाटील' });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('question')).toHaveTextContent('रमेश पाटील'));

        act(() => auth!.endDeviceCheck());

        expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
        expect(screen.getByTestId('question')).toHaveTextContent('-');
        expect(setAuthSession).not.toHaveBeenCalled();
        expect(clearRememberDevice).toHaveBeenCalled();
    });

    it('a known phone\'s password sign-in is stored as before and asks nothing', async () => {
        mockLogin.mockResolvedValue({ ...OPENED, deviceCheckRequired: false, accountName: null });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

        await act(async () => { await auth!.login('6000003002', 'pw', true); });

        expect(setAuthSession).toHaveBeenCalledWith(OPENED);
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('question')).toHaveTextContent('-');
    });
});
