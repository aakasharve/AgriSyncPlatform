/**
 * otpClient tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * FIX #3/#4 regression:
 * - ANDROID native path: verifyOtp sends X-Client-Platform: android header,
 *   receives refreshToken in the response, and calls setNativeRefreshSession.
 * - WEB path: no X-Client-Platform header is sent; setNativeRefreshSession
 *   is NOT called (cookie handles the token).
 *
 * Storage discipline: the native token MUST go to Keystore (setNativeRefreshSession),
 * never to localStorage. The web token goes into an HttpOnly cookie (server-set),
 * never read by JS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @capacitor/core — controls isNativePlatform() / getPlatform()
// ---------------------------------------------------------------------------

const mockIsNativePlatform = vi.fn(() => false as boolean);
const mockGetPlatform = vi.fn(() => 'web' as string);

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        isNativePlatform: () => mockIsNativePlatform(),
        getPlatform: () => mockGetPlatform(),
    },
}));

// ---------------------------------------------------------------------------
// Mock RefreshSessionStore
// ---------------------------------------------------------------------------

const mockSetNativeRefreshSession = vi.fn((_session?: unknown) => Promise.resolve());
const mockIsNativeSecureRefreshEnabled = vi.fn(() => false as boolean);

vi.mock('../../../../infrastructure/storage/RefreshSessionStore', () => ({
    setNativeRefreshSession: (session: unknown) => mockSetNativeRefreshSession(session),
    isNativeSecureRefreshEnabled: () => mockIsNativeSecureRefreshEnabled(),
    getNativeRefreshSession: vi.fn(() => Promise.resolve(null)),
    clearNativeRefreshSession: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Mock DeviceIdStore
// ---------------------------------------------------------------------------

vi.mock('../../../../infrastructure/storage/DeviceIdStore', () => ({
    getOrCreateDeviceId: vi.fn(() => 'test-device-id-001'),
    readDeviceId: vi.fn(() => 'test-device-id-001'),
    writeDeviceId: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof global.fetch;

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { verifyOtp } from '../otpClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setWebMode(): void {
    mockIsNativePlatform.mockReturnValue(false);
    mockGetPlatform.mockReturnValue('web');
    mockIsNativeSecureRefreshEnabled.mockReturnValue(false);
}

function setAndroidMode(): void {
    mockIsNativePlatform.mockReturnValue(true);
    mockGetPlatform.mockReturnValue('android');
    mockIsNativeSecureRefreshEnabled.mockReturnValue(true);
}

/** Returns the headers passed to the mocked fetch call */
function getCapturedHeaders(): Record<string, string> {
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    return (call[1].headers ?? {}) as Record<string, string>;
}

/** Returns the parsed body passed to the mocked fetch call */
function getCapturedBody(): Record<string, unknown> {
    const call = mockFetch.mock.calls[0] as [string, RequestInit];
    return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

/** Builds a mock successful fetch Response */
function mockSuccessResponse(extra: Record<string, unknown> = {}): Response {
    const body = {
        userId: 'u-test',
        accessToken: 'tok-access',
        expiresAtUtc: '2099-01-01T00:00:00Z',
        createdNewUser: false,
        ...extra,
    };
    return {
        ok: true,
        json: () => Promise.resolve(body),
        status: 200,
    } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests — WEB path
// ---------------------------------------------------------------------------

describe('otpClient.verifyOtp — WEB path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setWebMode();
        // Re-assert after clearAllMocks
        mockIsNativePlatform.mockReturnValue(false);
        mockGetPlatform.mockReturnValue('web');
        mockIsNativeSecureRefreshEnabled.mockReturnValue(false);
        mockSetNativeRefreshSession.mockReturnValue(Promise.resolve());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('does NOT send X-Client-Platform header on web', async () => {
        mockFetch.mockResolvedValueOnce(mockSuccessResponse());

        await verifyOtp('9876543210', '123456', undefined, {
            rememberDevice: true,
            deviceId: 'dev-web-001',
            platform: 'web',
        });

        const headers = getCapturedHeaders();
        expect(headers['X-Client-Platform']).toBeUndefined();
    });

    it('sends platform: web in the request body on web', async () => {
        mockFetch.mockResolvedValueOnce(mockSuccessResponse());

        await verifyOtp('9876543210', '123456', undefined, {
            rememberDevice: false,
            deviceId: 'dev-web-002',
        });

        const body = getCapturedBody();
        expect(body['platform']).toBe('web');
    });

    it('does NOT call setNativeRefreshSession on web', async () => {
        mockFetch.mockResolvedValueOnce(
            mockSuccessResponse({ refreshToken: 'should-be-ignored-on-web' })
        );

        await verifyOtp('9876543210', '123456', undefined, {
            rememberDevice: true,
            deviceId: 'dev-web-003',
        });

        expect(mockSetNativeRefreshSession).not.toHaveBeenCalled();
    });

    it('includes credentials: include for cookie handling on web', async () => {
        mockFetch.mockResolvedValueOnce(mockSuccessResponse());

        await verifyOtp('9876543210', '123456');

        const call = mockFetch.mock.calls[0] as [string, RequestInit];
        expect(call[1].credentials).toBe('include');
    });
});

// ---------------------------------------------------------------------------
// Tests — ANDROID native path  (FIX #3/#4)
// ---------------------------------------------------------------------------

describe('otpClient.verifyOtp — ANDROID native path (FIX #3/#4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setAndroidMode();
        // Re-assert after clearAllMocks
        mockIsNativePlatform.mockReturnValue(true);
        mockGetPlatform.mockReturnValue('android');
        mockIsNativeSecureRefreshEnabled.mockReturnValue(true);
        mockSetNativeRefreshSession.mockReturnValue(Promise.resolve());
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('sends X-Client-Platform: android header on native', async () => {
        mockFetch.mockResolvedValueOnce(
            mockSuccessResponse({ refreshToken: 'rt-native-abc' })
        );

        await verifyOtp('9876543210', '654321', undefined, {
            rememberDevice: true,
            deviceId: 'dev-android-001',
        });

        const headers = getCapturedHeaders();
        expect(headers['X-Client-Platform']).toBe('android');
    });

    it('sends platform: android in the request body on native', async () => {
        mockFetch.mockResolvedValueOnce(
            mockSuccessResponse({ refreshToken: 'rt-native-abc' })
        );

        await verifyOtp('9876543210', '654321', undefined, {
            rememberDevice: true,
            deviceId: 'dev-android-002',
        });

        const body = getCapturedBody();
        expect(body['platform']).toBe('android');
    });

    it('calls setNativeRefreshSession with the refreshToken from the response', async () => {
        const refreshToken = 'rt-android-secret-xyz';
        mockFetch.mockResolvedValueOnce(
            mockSuccessResponse({ refreshToken, expiresAtUtc: '2099-06-01T00:00:00Z' })
        );

        await verifyOtp('9876543210', '654321', undefined, {
            rememberDevice: true,
            deviceId: 'dev-android-003',
        });

        expect(mockSetNativeRefreshSession).toHaveBeenCalledOnce();
        const sessionArg = (mockSetNativeRefreshSession.mock.calls[0] as unknown[])[0] as { refreshToken: string; deviceId: string; expiresAtUtc: string };
        expect(sessionArg.refreshToken).toBe(refreshToken);
        expect(sessionArg.expiresAtUtc).toBe('2099-06-01T00:00:00Z');
    });

    it('passes a deviceId to setNativeRefreshSession', async () => {
        mockFetch.mockResolvedValueOnce(
            mockSuccessResponse({ refreshToken: 'rt-xyz', expiresAtUtc: '2099-01-01T00:00:00Z' })
        );

        await verifyOtp('9876543210', '654321', undefined, {
            rememberDevice: true,
            deviceId: 'dev-android-004',
        });

        expect(mockSetNativeRefreshSession).toHaveBeenCalledOnce();
        const sessionArg2 = (mockSetNativeRefreshSession.mock.calls[0] as unknown[])[0] as { deviceId: string };
        // Should be the deviceId passed in options (or the one from getOrCreateDeviceId if not passed)
        expect(typeof sessionArg2.deviceId).toBe('string');
        expect(sessionArg2.deviceId.length).toBeGreaterThan(0);
    });

    it('does NOT call setNativeRefreshSession when refreshToken is absent in response', async () => {
        // Edge case: backend returned no refreshToken (should not happen on native, but guard it)
        mockFetch.mockResolvedValueOnce(mockSuccessResponse());

        await verifyOtp('9876543210', '654321', undefined, {
            rememberDevice: true,
            deviceId: 'dev-android-005',
        });

        // No refreshToken in response → should not call setNativeRefreshSession
        expect(mockSetNativeRefreshSession).not.toHaveBeenCalled();
    });
});
