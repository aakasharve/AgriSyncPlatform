// spec: secure-remembered-device-sessions-2026-06-24
// AuthProvider: boot-validation state machine.
// - authStatus: 'checking' | 'authenticated' | 'anonymous'
// - On mount: ALWAYS attempt one refresh/validation via agriSyncClient.refreshSession()
//   unless a join deep link is active (those skip boot auth to avoid blocking workers).
// - Success → 'authenticated'; failure → 'anonymous'.
// - getAuthSession() is used only as warm state (access token for immediate renders),
//   never as final authentication truth.
// - logout is ASYNC () => Promise<void>: calls backend revoke first, then always clears
//   local state (Task 6.1). Callers use `void logout()` or `await logout()`.
// - mapSession does NOT copy refreshToken from the dto.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { agriSyncClient, type AuthResponseDto } from '../../infrastructure/api/AgriSyncClient';
import type { RefreshOutcome } from '../../infrastructure/api/transport';
import {
    AUTH_SESSION_CHANGED_EVENT,
    clearAuthSession,
    getAuthSession,
    getPresenceSession,
    setAuthSession,
    type AuthSession
} from '../../infrastructure/storage/AuthTokenStore';
// spec: data-principle-spine-2026-05-05/05.3
// On logout we drop the in-memory tenant DEK so the next user on the
// device cannot decrypt the previous user's voice clips without
// re-authenticating to the backend (and getting a fresh KMS-bound DEK).
import { clearCachedDek } from '../../infrastructure/security/tenantDekClient';
// spec: data-principle-spine-2026-05-05/06.5
// Same discipline for the in-memory consent token (HS256, 24h TTL).
import { clearCachedConsentToken } from '../../infrastructure/consent/ConsentTokenClient';
// spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2 / Task 6.1
// setRememberDevice is called on successful login so the flag persists
// for the refresh cycle (AgriSyncClient.refreshSession reads it).
// clearRememberDevice is called on logout so no stale "remember" flag
// persists for the next user or session.
import { setRememberDevice, clearRememberDevice } from '../../infrastructure/storage/RememberDeviceStore';
// spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1 + Task 6.2
// clearNativeRefreshSession is a web no-op but is called unconditionally so
// the Android implementation (Task 5.2) automatically gets fail-closed
// behaviour when the web build is ported.
import { clearNativeRefreshSession } from '../../infrastructure/storage/RefreshSessionStore';

// spec: secure-remembered-device-sessions-2026-06-24
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

interface AuthContextValue {
    session: AuthSession | null;
    authStatus: AuthStatus;
    isAuthenticated: boolean;
    isLoading: boolean;
    /**
     * True when the app is open on the strength of the stored presence marker
     * alone (offline cold start): `session.accessToken` is '' and NOTHING has
     * been verified. Server-bound work must treat this as "no token yet".
     */
    isOfflinePresence: boolean;
    authError: string | null;
    login: (phone: string, password: string, rememberDevice?: boolean) => Promise<void>;
    register: (phone: string, password: string, displayName: string) => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// spec: secure-remembered-device-sessions-2026-06-24
// mapSession does NOT copy refreshToken — the cookie carries it.
function mapSession(dto: AuthResponseDto): AuthSession {
    return {
        userId: dto.userId,
        accessToken: dto.accessToken,
        expiresAtUtc: dto.expiresAtUtc,
    };
}

// Detect if a join deep link is active — those flows skip boot auth.
function hasJoinDeepLink(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search);
        return Boolean((params.get('join') && params.get('farm')) || params.get('q'));
    } catch {
        return false;
    }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Warm state from storage (used for rendering, NOT final auth truth).
    const [session, setSession] = useState<AuthSession | null>(() => getAuthSession());
    // spec: secure-remembered-device-sessions-2026-06-24 — boot-validation state machine.
    const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
    const [isLoading, setIsLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    // spec: secure-remembered-device-sessions-2026-06-24 — FIX #2
    // syncFromStorage is called by onAuthSessionChanged (OTP login, QR-join, logout)
    // via the AUTH_SESSION_CHANGED_EVENT listener. It must also update authStatus so
    // that isAuthenticated === true immediately after a successful OTP login.
    // Without this, the user stays on LoginPage because authStatus stays 'anonymous'.
    // Guard: we do NOT override the initial 'checking' state here — the boot effect
    // always completes and sets the terminal status itself. This handler only fires
    // on EXPLICIT setAuthSession / clearAuthSession calls (not during boot).
    // Latest presence-mode identity, readable from the stable callback below.
    const presenceUserRef = useRef<string | null>(null);
    const syncFromStorage = useCallback(() => {
        // A tab that is open on a token-less PRESENCE session must not be
        // dropped to login by a storage/auth-changed event while its marker
        // survives, is valid, and is still the SAME user. Anything else (marker
        // gone/invalid, another user's marker, tab not in presence mode) fails
        // closed exactly as before.
        const presenceUser = presenceUserRef.current;
        let current = getAuthSession();
        if (current === null && presenceUser !== null) {
            const presence = getPresenceSession();
            if (presence !== null && presence.userId === presenceUser) {
                current = presence;
            }
        }
        setSession(current);
        setAuthStatus(current !== null ? 'authenticated' : 'anonymous');
    }, []);

    // Apply a refresh outcome to provider state.
    //
    // 'refreshed'   the server issued a session. Authenticated, no question.
    //
    // 'rejected'    the server judged the credential and refused it.
    //               refreshSession() has already cleared storage and the
    //               Keystore; mirror that into React state. Anonymous.
    //
    // 'unreachable' NOTHING judged the credential — we could not reach a
    //               server. This is the case that used to log farmers out for
    //               good, and the whole point of the fix is that we now do the
    //               opposite of clearing: whatever warm session is in storage
    //               stays, and the farmer keeps his app and his local records.
    //               An unverified access token grants nothing on its own — the
    //               first real request that meets a live server and gets a 401
    //               routes back through refreshSession() and clears properly.
    //               With no warm session we fall back to the token-less PRESENCE
    //               session (cold start, marker survives). With neither there is
    //               nothing to show, so 'anonymous' — still clearing NOTHING, so
    //               the durable Keystore token is there for the next launch.
    const applyRefreshOutcome = useCallback((outcome: RefreshOutcome) => {
        if (outcome.kind === 'refreshed') {
            setSession(outcome.session);
            setAuthError(null);
            setAuthStatus('authenticated');
            return;
        }

        if (outcome.kind === 'rejected') {
            clearAuthSession();
            setSession(null);
            setAuthStatus('anonymous');
            return;
        }

        // A warm session (live in-memory token) wins. On a COLD start there is
        // none, but the non-secret presence marker survives: fall back to a
        // TOKEN-LESS presence session so a farmer relaunching with no signal
        // lands in the offline app, not on the login screen (locked offline
        // ruling: attendance capture works offline). It carries no token, so
        // nothing server-bound can use it; the first reachable refresh mints a
        // real session or, if the server judges the credential dead, clears it.
        const warm = getAuthSession() ?? getPresenceSession();
        setSession(warm);
        setAuthStatus(warm !== null ? 'authenticated' : 'anonymous');
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            applyRefreshOutcome(await agriSyncClient.refreshSession());
        } catch {
            // refreshSession() does not throw by contract; if some future edit
            // makes it, treat the outcome as unknown rather than as proof the
            // credential is dead — the same reasoning as 'unreachable'.
            applyRefreshOutcome({ kind: 'unreachable' });
        } finally {
            setIsLoading(false);
        }
    }, [applyRefreshOutcome]);

    // Boot-validation effect: runs once on mount.
    // Always attempts one cookie refresh unless a join deep link is active.
    useEffect(() => {
        if (hasJoinDeepLink()) {
            // Join flows handle their own auth. Skip boot refresh to avoid
            // blocking the worker QR flow.
            setAuthStatus('anonymous');
            return;
        }

        // Even if we have a valid-looking access token in storage, we still
        // attempt a refresh to validate the server-side session. This prevents
        // a stale access token from being treated as truth — but a failure to
        // ASK is not an answer, so see applyRefreshOutcome for what each of the
        // three outcomes means.
        void agriSyncClient.refreshSession()
            .then(applyRefreshOutcome)
            .catch(() => applyRefreshOutcome({ kind: 'unreachable' }));
    }, [applyRefreshOutcome]);

    // Connectivity is back (or the app is foregrounded) while we are open on
    // presence alone: re-run the refresh so a REAL token replaces the empty one
    // before authenticated work resumes. A judged rejection clears the session
    // (revoked/blocked users end here); 'unreachable' changes nothing. Only
    // armed while in presence mode, so a normal session never refreshes extra.
    const offlinePresence = authStatus === 'authenticated' && !session?.accessToken;
    const presenceUserId = offlinePresence ? (session?.userId ?? null) : null;
    useEffect(() => {
        presenceUserRef.current = presenceUserId;
    }, [presenceUserId]);
    useEffect(() => {
        if (!offlinePresence) {
            return;
        }

        const retry = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }
            void agriSyncClient.refreshSession()
                .then(applyRefreshOutcome)
                .catch(() => applyRefreshOutcome({ kind: 'unreachable' }));
        };

        window.addEventListener('online', retry);
        document.addEventListener('visibilitychange', retry);
        return () => {
            window.removeEventListener('online', retry);
            document.removeEventListener('visibilitychange', retry);
        };
    }, [offlinePresence, applyRefreshOutcome]);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (!event.key || event.key.includes('agrisync_auth_session_v1')) {
                syncFromStorage();
            }
        };

        const onAuthSessionChanged = () => {
            syncFromStorage();
        };

        window.addEventListener('storage', onStorage);
        window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onAuthSessionChanged);

        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onAuthSessionChanged);
        };
    }, [syncFromStorage]);

    const login = useCallback(async (phone: string, password: string, rememberDevice = false) => {
        setIsLoading(true);
        setAuthError(null);
        try {
            const response = await agriSyncClient.login({
                phone,
                password,
                rememberDevice,
                deviceId: '',          // AgriSyncClient fills this via getOrCreateDeviceId()
                platform: 'web',
            });
            // spec: secure-remembered-device-sessions-2026-06-24 — Task 4.2
            // Persist the remember-device flag so AgriSyncClient.refreshSession()
            // sends the correct value on the next refresh cycle.
            setRememberDevice(rememberDevice);
            const next = mapSession(response);
            setAuthSession(next);
            setSession(next);
            setAuthStatus('authenticated');
        } catch (error) {
            console.error('[AuthProvider] Login failed', error);
            setAuthError('Login failed. Check phone/password and try again.');
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const register = useCallback(async (phone: string, password: string, displayName: string) => {
        setIsLoading(true);
        setAuthError(null);
        try {
            const response = await agriSyncClient.register({
                phone,
                password,
                displayName,
                appId: 'shramsafal',
                role: 'PrimaryOwner',
            });
            const next = mapSession(response);
            setAuthSession(next);
            setSession(next);
            setAuthStatus('authenticated');
        } catch (error) {
            console.error('[AuthProvider] Registration failed', error);
            setAuthError('Registration failed. Use a new phone number and try again.');
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const clearAuthError = useCallback(() => {
        setAuthError(null);
    }, []);

    // spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1
    // logout is ASYNC: call backend revoke FIRST, then ALWAYS clear local
    // state even when the backend call fails (fail-closed guarantee).
    // Order:
    //   1. POST /user/auth/logout (backend revoke) — wrapped in try/catch;
    //      error is logged but does NOT abort cleanup.
    //   2. clearAuthSession() — wipes the access token from localStorage.
    //   3. clearCachedDek() — drops in-memory tenant DEK.
    //      (data-principle-spine-2026-05-05/05.3)
    //   4. clearCachedConsentToken() — drops in-memory consent token.
    //      (data-principle-spine-2026-05-05/06.5)
    //   5. clearRememberDevice() — removes the remember-device flag so a
    //      fresh login is required before the next refresh cycle honours it.
    //   6. clearNativeRefreshSession() — web no-op; Android Keystore wipe.
    //   7. Set session null + authStatus 'anonymous'.
    const logout = useCallback(async () => {
        try {
            await agriSyncClient.logoutCurrentDevice();
        } catch (err) {
            // Backend revoke failed (network error, 401, etc.).
            // Record the error but proceed with local cleanup unconditionally.
            console.error('[AuthProvider] Backend logout failed — clearing local state regardless', err);
        }
        // Always clear — even when the backend call threw.
        clearAuthSession();
        // spec: data-principle-spine-2026-05-05/05.3
        clearCachedDek();
        // spec: data-principle-spine-2026-05-05/06.5
        clearCachedConsentToken();
        // spec: secure-remembered-device-sessions-2026-06-24 / Task 6.1
        clearRememberDevice();
        await clearNativeRefreshSession();
        setSession(null);
        setAuthStatus('anonymous');
        setAuthError(null);
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        authStatus,
        isAuthenticated: authStatus === 'authenticated',
        isLoading,
        isOfflinePresence: offlinePresence,
        authError,
        login,
        register,
        logout,
        refresh,
        clearAuthError,
    }), [session, authStatus, isLoading, offlinePresence, authError, login, register, logout, refresh, clearAuthError]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextValue => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

/**
 * SAFE optional accessor — returns `null` instead of throwing when there is
 * no `AuthProvider` in the tree. Mirrors `useOptionalFarmContext()` in
 * `core/session/FarmContext.tsx`, and exists for the same reason: dev preview
 * shells (e.g. `?preview=labour` -> `LabourPreview`) mount a feature BEFORE
 * any provider, so a hook that needs to know whether auth has settled must be
 * able to ask without crashing the preview. Use `useAuth()` everywhere in the
 * real app — it always has an `AuthProvider` above it.
 */
export const useOptionalAuth = (): AuthContextValue | null => {
    return useContext(AuthContext);
};
