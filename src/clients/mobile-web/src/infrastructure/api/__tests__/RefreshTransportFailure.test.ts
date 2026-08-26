/**
 * refreshSession() — transport failure must NOT destroy the credential.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 * -------------------------------------
 * `AuthProvider` fires exactly one `refreshSession()` on every app launch.
 * The old implementation caught **any** thrown error — including a DNS
 * failure, a TLS timeout, a captive portal, or a hibernated backend — and
 * ran the fail-closed path: `clearAuthSession()` plus
 * `clearNativeRefreshSession()`, which on Android wipes the Keystore-backed
 * refresh token. That token is the ONLY durable credential on the device.
 *
 * So one network hiccup at launch, in a field, on bad signal, logged the
 * farmer out permanently and pointed the app at an empty local database. He
 * cannot get back in without a fresh OTP — and the APK cannot be patched
 * after it is handed out.
 *
 * The distinction the fix restores is the one the sync layer already makes in
 * `RejectionPolicy.categorizePushFailure`: did the server JUDGE us (401/403 —
 * the credential really is dead, clear it), or did we never reach a server
 * that could judge us (no response / 5xx / 408 / 429 — the credential's
 * validity is still unknown, so keep it)?
 *
 * spec: secure-remembered-device-sessions-2026-06-24 (Task 6.2, amended)
 * evidence: docs/LAUNCH-READINESS-AND-AGRISTACK-2026-08-23.md — Decision 2 item 1
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
        default: { create: vi.fn(() => fakeInstance) },
        AxiosError: actual.AxiosError,
    };
});

vi.mock('../../../infrastructure/storage/DeviceIdStore', () => ({
    readDeviceId: vi.fn(() => 'test-device-id-001'),
    writeDeviceId: vi.fn(),
    getOrCreateDeviceId: vi.fn(() => 'test-device-id-001'),
}));

vi.mock('../../../infrastructure/storage/RememberDeviceStore', () => ({
    getRememberDevice: vi.fn(() => true),
    setRememberDevice: vi.fn(),
    clearRememberDevice: vi.fn(),
}));

// RefreshSessionStore — the Keystore-backed durable credential on Android.
// `mockNativeEnabled` flips the branch under test; `mockStoredNative` is what
// the Keystore currently holds.
const mockClearNativeRefreshSession = vi.fn();
const mockSetNativeRefreshSession = vi.fn();
let mockNativeEnabled = false;
let mockStoredNative: { refreshToken: string; deviceId: string; expiresAtUtc: string } | null = null;

vi.mock('../../../infrastructure/storage/RefreshSessionStore', () => ({
    clearNativeRefreshSession: (...args: unknown[]) => mockClearNativeRefreshSession(...args),
    getNativeRefreshSession: vi.fn(() => Promise.resolve(mockStoredNative)),
    setNativeRefreshSession: (...args: unknown[]) => mockSetNativeRefreshSession(...args),
    isNativeSecureRefreshEnabled: vi.fn(() => mockNativeEnabled),
}));

vi.mock('../../../infrastructure/telemetry/ClientErrorReporter', () => ({
    reportClientError: vi.fn(),
}));

vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: vi.fn(() => null),
    setAuthSession: vi.fn(),
    clearAuthSession: vi.fn(),
    AUTH_SESSION_CHANGED_EVENT: 'agrisync:auth-session-changed',
}));

// ---------------------------------------------------------------------------
// Error builders — the two shapes axios produces.
// ---------------------------------------------------------------------------

/** No `response` at all: DNS failure, connection refused, TLS, timeout, CORS,
 *  or a backend that is simply asleep. Nothing judged the credential. */
function networkError(message: string): Error {
    return Object.assign(new Error(message), { isAxiosError: true });
}

/** The server answered with a status. */
function httpError(status: number): Error {
    return Object.assign(new Error(`HTTP ${status}`), {
        isAxiosError: true,
        response: { status, data: {} },
    });
}

async function newClient() {
    const { AgriSyncClient } = await import('../AgriSyncClient');
    return new AgriSyncClient();
}

describe('refreshSession() — a network failure must not log the farmer out', () => {
    beforeEach(() => {
        lsMock = makeLsMock();
        lsMock._store[DEVICE_ID_KEY] = 'test-device-id-001';
        Object.defineProperty(globalThis, 'localStorage', { value: lsMock, writable: true, configurable: true });
        vi.clearAllMocks();
        mockNativeEnabled = false;
        mockStoredNative = null;
    });

    // -----------------------------------------------------------------------
    // WEB branch (HttpOnly cookie)
    // -----------------------------------------------------------------------

    it('web: a connection failure returns "unreachable" and clears nothing', async () => {
        const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockRejectedValueOnce(networkError('Network Error'));

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('unreachable');
        expect(clearAuthSession).not.toHaveBeenCalled();
        expect(mockClearNativeRefreshSession).not.toHaveBeenCalled();
    });

    it.each([500, 502, 503, 504, 408, 429])(
        'web: HTTP %i is the server talking about itself, not about us → "unreachable"',
        async (status) => {
            const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
            mockPost.mockRejectedValueOnce(httpError(status));

            const outcome = await (await newClient()).refreshSession();

            expect(outcome.kind).toBe('unreachable');
            expect(clearAuthSession).not.toHaveBeenCalled();
            expect(mockClearNativeRefreshSession).not.toHaveBeenCalled();
        },
    );

    it.each([400, 401, 403, 404, 409, 422])(
        'web: HTTP %i means the server judged the credential → "rejected", and we clear',
        async (status) => {
            const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
            mockPost.mockRejectedValueOnce(httpError(status));

            const outcome = await (await newClient()).refreshSession();

            expect(outcome.kind).toBe('rejected');
            expect(clearAuthSession).toHaveBeenCalled();
            expect(mockClearNativeRefreshSession).toHaveBeenCalled();
        },
    );

    it('web: a captive portal answering 200 with no access token is "unreachable", not a session', async () => {
        const { clearAuthSession, setAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        // A hotel/railway wifi portal intercepts the POST and returns its own
        // HTML login page with status 200. Treating that as a successful
        // refresh would write a session with an undefined access token.
        mockPost.mockResolvedValueOnce({ data: { html: '<!doctype html>' } });

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('unreachable');
        expect(setAuthSession).not.toHaveBeenCalled();
        expect(clearAuthSession).not.toHaveBeenCalled();
    });

    it('web: a real refresh still succeeds and stores the session', async () => {
        const { setAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockPost.mockResolvedValueOnce({
            data: {
                userId: 'u-123',
                accessToken: 'fresh-access-token',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            },
        });

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('refreshed');
        expect(outcome.kind === 'refreshed' && outcome.session.accessToken).toBe('fresh-access-token');
        expect(setAuthSession).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // NATIVE branch (Android Keystore) — where the permanent damage happened
    // -----------------------------------------------------------------------

    it('android: a connection failure leaves the Keystore refresh token intact', async () => {
        const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockNativeEnabled = true;
        mockStoredNative = {
            refreshToken: 'durable-keystore-token',
            deviceId: 'test-device-id-001',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        mockPost.mockRejectedValueOnce(networkError('Network Error'));

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('unreachable');
        // THE ASSERTION THAT MATTERS: the only durable credential on the phone
        // survives a bad signal. Without this the farmer is locked out for the
        // life of the APK.
        expect(mockClearNativeRefreshSession).not.toHaveBeenCalled();
        expect(clearAuthSession).not.toHaveBeenCalled();
    });

    it('android: a hibernated backend (503) leaves the Keystore refresh token intact', async () => {
        mockNativeEnabled = true;
        mockStoredNative = {
            refreshToken: 'durable-keystore-token',
            deviceId: 'test-device-id-001',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        mockPost.mockRejectedValueOnce(httpError(503));

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('unreachable');
        expect(mockClearNativeRefreshSession).not.toHaveBeenCalled();
    });

    it('android: a 401 still wipes the Keystore — fail-closed is preserved where it belongs', async () => {
        const { clearAuthSession } = await import('../../../infrastructure/storage/AuthTokenStore');
        mockNativeEnabled = true;
        mockStoredNative = {
            refreshToken: 'revoked-token',
            deviceId: 'test-device-id-001',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        mockPost.mockRejectedValueOnce(httpError(401));

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('rejected');
        expect(mockClearNativeRefreshSession).toHaveBeenCalled();
        expect(clearAuthSession).toHaveBeenCalled();
    });

    it('android: no stored Keystore session at all is still "rejected" — there is nothing to preserve', async () => {
        mockNativeEnabled = true;
        mockStoredNative = null;

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('rejected');
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('android: a successful refresh persists the rotated token', async () => {
        mockNativeEnabled = true;
        mockStoredNative = {
            refreshToken: 'old-token',
            deviceId: 'test-device-id-001',
            expiresAtUtc: '2099-01-01T00:00:00Z',
        };
        mockPost.mockResolvedValueOnce({
            data: {
                userId: 'u-123',
                accessToken: 'fresh-access-token',
                refreshToken: 'rotated-token',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            },
        });

        const outcome = await (await newClient()).refreshSession();

        expect(outcome.kind).toBe('refreshed');
        expect(mockSetNativeRefreshSession).toHaveBeenCalledWith(
            expect.objectContaining({ refreshToken: 'rotated-token' }),
        );
    });
});
