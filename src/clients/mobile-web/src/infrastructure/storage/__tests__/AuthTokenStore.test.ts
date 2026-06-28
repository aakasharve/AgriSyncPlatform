/**
 * AuthTokenStore tests — spec: secure-remembered-device-sessions-2026-06-24
 *
 * Security hardening (CodeQL: clear-text storage of sensitive information):
 * the access token is held IN-MEMORY only; localStorage carries just a
 * non-sensitive presence marker (userId + expiresAtUtc) — NO token.
 *
 * Proves:
 * - setAuthSession writes ONLY userId + expiresAtUtc to localStorage; the
 *   accessToken (and refreshToken) are NEVER persisted.
 * - getAuthSession returns the full session (with the in-memory access token)
 *   only while the token is held in memory.
 * - After a simulated page reload (in-memory token lost) getAuthSession reads
 *   null even though the presence marker survives — but hasSessionPresence()
 *   stays true so boot can decide to refresh.
 * - A legacy record that persisted accessToken/refreshToken is migrated on
 *   read so the clear-text token is purged from localStorage.
 * - clearAuthSession removes the key, drops the in-memory token, and emits
 *   AUTH_SESSION_CHANGED_EVENT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getAuthSession,
    setAuthSession,
    clearAuthSession,
    hasSessionPresence,
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
    // Clear in-memory token between tests (clearAuthSession resets it).
    clearAuthSession();
    windowMock.dispatchEvent.mockClear();
});

describe('AuthTokenStore', () => {
    describe('setAuthSession', () => {
        it('persists ONLY userId + expiresAtUtc — never accessToken or refreshToken', () => {
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
            expect(parsed.expiresAtUtc).toBe('2099-01-01T00:00:00Z');
            // Critical: no token of any kind is persisted to localStorage.
            expect('accessToken' in parsed).toBe(false);
            expect('refreshToken' in parsed).toBe(false);
        });

        it('keeps the access token retrievable in-memory via getAuthSession', () => {
            setAuthSession({
                userId: 'u-1',
                accessToken: 'tok-abc',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            });
            const result = getAuthSession();
            expect(result).not.toBeNull();
            expect(result!.userId).toBe('u-1');
            expect(result!.accessToken).toBe('tok-abc');
            expect(result!.expiresAtUtc).toBe('2099-01-01T00:00:00Z');
        });
    });

    describe('getAuthSession', () => {
        it('returns null when only the presence marker exists but no in-memory token (simulated reload)', () => {
            // Simulate the post-reload state: marker survives in localStorage,
            // but the in-memory token was lost on module re-eval.
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify({
                userId: 'u-2',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            }));
            expect(getAuthSession()).toBeNull();
            // ...but boot can still tell a session existed.
            expect(hasSessionPresence()).toBe(true);
        });

        it('migrates a legacy record that persisted accessToken — token purged from storage', () => {
            const legacy = {
                userId: 'u-2',
                accessToken: 'tok-legacy',
                refreshToken: 'should-be-purged',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            };
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify(legacy));
            // No in-memory token yet → session is not usable, but the read
            // migrates the stored record to strip the clear-text token.
            expect(getAuthSession()).toBeNull();
            const migrated = JSON.parse(lsMock.getItem(AUTH_SESSION_KEY)!);
            expect(migrated.userId).toBe('u-2');
            expect(migrated.expiresAtUtc).toBe('2099-01-01T00:00:00Z');
            expect('accessToken' in migrated).toBe(false);
            expect('refreshToken' in migrated).toBe(false);
        });

        it('purges a token-only legacy record entirely', () => {
            lsMock.setItem(AUTH_SESSION_KEY, JSON.stringify({ refreshToken: 'raw-legacy-token' }));
            expect(getAuthSession()).toBeNull();
            expect(lsMock.getItem(AUTH_SESSION_KEY)).toBeNull();
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
        it('removes the presence marker and drops the in-memory token', () => {
            setAuthSession({
                userId: 'u-4',
                accessToken: 'tok-xyz',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            });
            expect(lsMock.getItem(AUTH_SESSION_KEY)).not.toBeNull();
            expect(getAuthSession()).not.toBeNull();
            clearAuthSession();
            expect(lsMock.getItem(AUTH_SESSION_KEY)).toBeNull();
            expect(getAuthSession()).toBeNull();
        });

        it('emits AUTH_SESSION_CHANGED_EVENT after clearing', () => {
            setAuthSession({
                userId: 'u-5',
                accessToken: 'tok-def',
                expiresAtUtc: '2099-01-01T00:00:00Z',
            });
            windowMock.dispatchEvent.mockClear();
            clearAuthSession();
            expect(windowMock.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: AUTH_SESSION_CHANGED_EVENT }),
            );
        });
    });
});
