/**
 * AuthTokenStore tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Proves:
 * - setAuthSession never writes refreshToken to storage.
 * - getAuthSession ignores a legacy stored refreshToken field.
 * - A legacy agrisync_auth_session_v1 containing ONLY refreshToken (no accessToken) reads as null.
 * - clearAuthSession removes the key and emits AUTH_SESSION_CHANGED_EVENT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getAuthSession,
    setAuthSession,
    clearAuthSession,
    AUTH_SESSION_CHANGED_EVENT,
    type AuthSession,
} from '../AuthTokenStore';

const AUTH_SESSION_KEY = 'agrisync_auth_session_v1';

// Minimal localStorage mock
function makeLocalStorageMock(): Storage {
    const store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        key: (index: number) => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
    };
}

function makeWindowMock(localStorage: Storage): { localStorage: Storage; dispatchEvent: ReturnType<typeof vi.fn> } {
    const dispatched: Event[] = [];
    return {
        localStorage,
        dispatchEvent: vi.fn((e: Event) => { dispatched.push(e); return true; }),
    };
}

let lsMock: Storage;
let windowMock: ReturnType<typeof makeWindowMock>;

beforeEach(() => {
    lsMock = makeLocalStorageMock();
    windowMock = makeWindowMock(lsMock);
    Object.defineProperty(globalThis, 'window', { value: windowMock, writable: true, configurable: true });
    Object.defineProperty(windowMock, 'localStorage', { value: lsMock, writable: false, configurable: true });
});

describe('AuthTokenStore', () => {
    describe('setAuthSession', () => {
        it('stores userId, accessToken, expiresAtUtc — never refreshToken', () => {
            const session: AuthSession = {
                userId: 'u-1',
                accessToken: 'tok-abc',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            };
            setAuthSession(session);
            const raw = lsMock.getItem(AUTH_SESSION_KEY);
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!);
            expect(parsed.userId).toBe('u-1');
            expect(parsed.accessToken).toBe('tok-abc');
            expect(parsed.expiresAtUtc).toBe('2099-01-01T00:00:00Z');
            // Critical: refreshToken must never be written
            expect('refreshToken' in parsed).toBe(false);
        });
    });

    describe('getAuthSession', () => {
        it('returns a valid session ignoring any legacy refreshToken field', () => {
            // Simulate a legacy record that happened to carry refreshToken
            const legacy = {
                userId: 'u-2',
                accessToken: 'tok-legacy',
                refreshToken: 'should-be-ignored',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            };
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify(legacy));
            const result = getAuthSession();
            expect(result).not.toBeNull();
            expect(result!.userId).toBe('u-2');
            expect(result!.accessToken).toBe('tok-legacy');
            expect(result!.expiresAtUtc).toBe('2099-01-01T00:00:00Z');
            // The returned AuthSession type has no refreshToken field
            expect('refreshToken' in (result as object)).toBe(false);
        });

        it('returns null when the stored record only has refreshToken and no accessToken', () => {
            const legacyRefreshOnly = {
                refreshToken: 'raw-legacy-token',
            };
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify(legacyRefreshOnly));
            const result = getAuthSession();
            expect(result).toBeNull();
        });

        it('returns null when storage is empty', () => {
            expect(getAuthSession()).toBeNull();
        });

        it('returns null when the record is missing required fields', () => {
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify({ userId: 'u-3' }));
            expect(getAuthSession()).toBeNull();
        });
    });

    describe('clearAuthSession', () => {
        it('removes the auth session key', () => {
            const session: AuthSession = {
                userId: 'u-4',
                accessToken: 'tok-xyz',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            };
            setAuthSession(session);
            expect(lsMock.getItem(AUTH_SESSION_KEY)).not.toBeNull();
            clearAuthSession();
            expect(lsMock.getItem(AUTH_SESSION_KEY)).toBeNull();
        });

        it('emits AUTH_SESSION_CHANGED_EVENT after clearing', () => {
            const session: AuthSession = {
                userId: 'u-5',
                accessToken: 'tok-def',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            };
            setAuthSession(session);
            windowMock.dispatchEvent.mockClear();
            clearAuthSession();
            expect(windowMock.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: AUTH_SESSION_CHANGED_EVENT }),
            );
        });
    });
});
