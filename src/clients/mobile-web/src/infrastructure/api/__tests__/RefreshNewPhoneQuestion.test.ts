/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56).
 *
 * A boot refresh whose answer says `deviceCheckRequired` (a phone that has not answered the new-phone question) must
 * NOT become a session: its token opens nothing. refreshSession() stores nothing, keeps the refresh credential (it is
 * the session the answer will name; on Android the rotated one is persisted), puts the question in
 * PendingDeviceCheckStore and returns { kind: 'device-check' }. A known phone's refresh is unchanged.
 * Harness as AuthResourceCookieRefresh.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.fn();
const h = vi.hoisted(() => ({ native: false }));

vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios');
    const fakeInstance = {
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
        post: mockPost,
        get: vi.fn(),
        request: vi.fn(),
    };
    return { ...actual, default: { create: vi.fn(() => fakeInstance) }, AxiosError: actual.AxiosError };
});
vi.mock('../../../infrastructure/storage/DeviceIdStore', () => ({
    readDeviceId: vi.fn(() => 'phone-1'),
    writeDeviceId: vi.fn(),
    getOrCreateDeviceId: vi.fn(() => 'phone-1'),
}));
vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => true),
    setRememberDevice: vi.fn(),
    clearRememberDevice: vi.fn(),
}));
const mockSetNative = vi.fn();
const mockClearNative = vi.fn();
vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: (...a: unknown[]) => mockClearNative(...a),
    getNativeRefreshSession: vi.fn(() => Promise.resolve({ refreshToken: 'keystore-old', deviceId: 'phone-1', expiresAtUtc: '' })),
    setNativeRefreshSession: (...a: unknown[]) => mockSetNative(...a),
    isNativeSecureRefreshEnabled: vi.fn(() => h.native),
}));
vi.mock('../../../infrastructure/telemetry/ClientErrorReporter', () => ({ reportClientError: vi.fn() }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: vi.fn(() => null),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));
vi.mock('../../../infrastructure/storage/PendingLogoutStore', () => ({
    hasPendingLogout: vi.fn(() => false),
    markPendingLogout: vi.fn(),
    clearPendingLogout: vi.fn(),
}));

import { clearPendingDeviceCheck, getPendingDeviceCheck } from '../../storage/PendingDeviceCheckStore';

const HELD = {
    userId: 'u-owner',
    accessToken: 'opens-nothing',
    expiresAtUtc: '2099-01-01T00:00:00Z',
    deviceCheckRequired: true,
    accountName: 'रमेश पाटील',
};

describe('refreshSession() and the new-phone question', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPendingDeviceCheck();
        h.native = false;
    });

    it('web: a held refresh stores no session and asks the question', async () => {
        const { setAuthSession, clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockResolvedValueOnce({ data: HELD });
        const { AgriSyncClient } = await import('../AgriSyncClient');

        const outcome = await new AgriSyncClient().refreshSession();

        expect(outcome).toEqual({ kind: 'device-check' });
        expect(setAuthSession).not.toHaveBeenCalled();
        expect(clearAuthSession).toHaveBeenCalled();
        expect(mockClearNative).not.toHaveBeenCalled();
        expect(getPendingDeviceCheck()).toEqual({ userId: 'u-owner', accountName: 'रमेश पाटील' });
    });

    it('Android: the rotated credential is kept (it is the session the answer names), no session is stored', async () => {
        h.native = true;
        const { setAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockResolvedValueOnce({ data: { ...HELD, refreshToken: 'keystore-rotated' } });
        const { AgriSyncClient } = await import('../AgriSyncClient');

        const outcome = await new AgriSyncClient().refreshSession();

        expect(outcome).toEqual({ kind: 'device-check' });
        expect(mockSetNative).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'keystore-rotated' }));
        expect(mockClearNative).not.toHaveBeenCalled();
        expect(setAuthSession).not.toHaveBeenCalled();
        expect(getPendingDeviceCheck()?.accountName).toBe('रमेश पाटील');
    });

    it('a known phone refreshes as before: a session, and no question', async () => {
        const { setAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockResolvedValueOnce({ data: { userId: 'u-owner', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z', deviceCheckRequired: false, accountName: null } });
        const { AgriSyncClient } = await import('../AgriSyncClient');

        const outcome = await new AgriSyncClient().refreshSession();

        expect(outcome.kind).toBe('refreshed');
        expect(setAuthSession).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'opens' }));
        expect(getPendingDeviceCheck()).toBeNull();
    });

    it('a server from before the question (no field at all) is read as "not asked"', async () => {
        mockPost.mockResolvedValueOnce({ data: { userId: 'u-owner', accessToken: 'opens', expiresAtUtc: '2099-01-01T00:00:00Z' } });
        const { AgriSyncClient } = await import('../AgriSyncClient');

        expect((await new AgriSyncClient().refreshSession()).kind).toBe('refreshed');
        expect(getPendingDeviceCheck()).toBeNull();
    });
});
