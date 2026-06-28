/**
 * AuthResourceCookieRefresh tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - Axios instances are created with withCredentials: true.
 * - refreshSession() sends no refresh token in the body; sends rememberDevice + X-Device-Id.
 * - A 401 on refresh clears the auth session (fail closed).
 * - refreshSession() uses the HttpOnly cookie path (no refreshToken body field).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal localStorage mock
// ---------------------------------------------------------------------------
const DEVICE_ID_KEY = 'agrisync_device_id_v1';

function makeLsMock(): Storage & { _store: Record<string, string> } {
    const _store: Record<string, string> = {};
    return {
        _store,
        getItem: (k: string) => _store[k] ?? null,
        setItem: (k: string, v: string) => { _store[k] = v; },
        removeItem: (k: string) => { delete _store[k]; },
        clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
        key: (i: number) => Object.keys(_store)[i] ?? null,
        get length() { return Object.keys(_store).length; },
    };
}

let lsMock: ReturnType<typeof makeLsMock>;

// ---------------------------------------------------------------------------
// Mock axios at module level
// ---------------------------------------------------------------------------
const mockPost = vi.fn();

vi.mock('axios', async () => {
    const actual = await vi.importActual<typeof import('axios')>('axios');
    const fakeInstance = {
        interceptors: {
            request: { use: vi.fn() },
            response: { use: vi.fn() },
        },
        post: mockPost,
        get: vi.fn(),
        request: vi.fn(),
    };
    return {
        ...actual,
        default: {
            create: vi.fn(() => fakeInstance),
        },
        AxiosError: actual.AxiosError,
    };
});

// Mock DeviceIdStore — include getOrCreateDeviceId since AgriSyncClient imports
// it directly (B002 DRY consolidation).
vi.mock('../../../infrastructure/storage/DeviceIdStore', () => ({
    readDeviceId: vi.fn(() => 'test-device-id-001'),
    writeDeviceId: vi.fn(),
    getOrCreateDeviceId: vi.fn(() => 'test-device-id-001'),
}));

// Mock RememberDeviceStore
vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => true),
    setRememberDevice: vi.fn(),
    clearRememberDevice: vi.fn(),
}));

// Mock RefreshSessionStore — so we can assert clearNativeRefreshSession is
// called on 401 (the real implementation is a no-op on web, but the call MUST
// happen so Android/native builds pick it up correctly).
const mockClearNativeRefreshSession = vi.fn();
vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: (...args: unknown[]) => mockClearNativeRefreshSession(...args),
    getNativeRefreshSession: vi.fn(() => Promise.resolve(null)),
    setNativeRefreshSession: vi.fn(),
    isNativeSecureRefreshEnabled: vi.fn(() => false),
}));

// Mock telemetry
vi.mock('../../../infrastructure/telemetry/ClientErrorReporter', () => ({
    reportClientError: vi.fn(),
}));

// Mock AuthTokenStore
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: vi.fn(() => null),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));

describe('AgriSyncClient — cookie-based refresh (spec: secure-remembered-device-sessions-2026-06-24)', () => {
    beforeEach(() => {
        lsMock = makeLsMock();
        lsMock._store[DEVICE_ID_KEY] = 'test-device-id-001';
        Object.defineProperty(globalThis, 'localStorage', { value: lsMock, writable: true, configurable: true });
        vi.clearAllMocks();
    });

    it('creates axios instances with withCredentials: true', async () => {
        const axiosMod = await import('axios');
        const { AgriSyncClient } = await import('../AgriSyncClient');
        new AgriSyncClient();
        expect(axiosMod.default.create).toHaveBeenCalledWith(
            expect.objectContaining({ withCredentials: true }),
        );
        // Both http and authHttp must be withCredentials
        const calls = (axiosMod.default.create as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.length).toBeGreaterThanOrEqual(2);
        calls.forEach((call: unknown[]) => {
            expect((call[0] as Record<string, unknown>).withCredentials).toBe(true);
        });
    });

    it('refreshSession() sends rememberDevice + deviceId + platform but NO refreshToken body', async () => {
        const { clearAuthSession, setAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockResolvedValueOnce({
            data: {
                userId: 'u-123',
                accessToken: 'fresh-access-token',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            },
        });

        const { AgriSyncClient } = await import('../AgriSyncClient');
        const client = new AgriSyncClient();
        await client.refreshSession();

        expect(mockPost).toHaveBeenCalledWith(
            '/user/auth/refresh',
            expect.objectContaining({
                rememberDevice: expect.any(Boolean),
                deviceId: expect.any(String),
                platform: 'web',
            }),
        );

        // CRITICAL: refreshToken must NOT appear in the body
        const body = (mockPost as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<string, unknown>;
        expect('refreshToken' in body).toBe(false);

        // On success, session is set
        expect(setAuthSession).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u-123',
                accessToken: 'fresh-access-token',
            }),
        );
        // refreshToken must not be in the stored session
        const stored = (setAuthSession as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
        expect('refreshToken' in stored).toBe(false);

        void clearAuthSession;
    });

    it('refreshSession() clears the session AND calls clearNativeRefreshSession on 401', async () => {
        const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        const err = Object.assign(new Error('Unauthorized'), {
            response: { status: 401, data: {} },
            isAxiosError: true,
        });
        mockPost.mockRejectedValueOnce(err);
        // Reset call count so previous tests don't bleed in
        mockClearNativeRefreshSession.mockClear();

        const { AgriSyncClient } = await import('../AgriSyncClient');
        const client = new AgriSyncClient();
        const result = await client.refreshSession();

        expect(result).toBeNull();
        // clearAuthSession must be called fail-closed
        expect(clearAuthSession).toHaveBeenCalled();
        // clearNativeRefreshSession must ALSO be called so that on Android/native
        // builds the Keystore-backed session is wiped when the server rejects the
        // refresh. On web this is a no-op stub, but the call must be present.
        expect(mockClearNativeRefreshSession).toHaveBeenCalled();
    });
});
