// spec: secure-remembered-device-sessions-2026-06-24
// AuthProvider: boot-validation state machine.
// - authStatus: 'checking' | 'authenticated' | 'anonymous'
// - On mount: ALWAYS attempt one refresh/validation via agriSyncClient.refreshSession()
//   unless a join deep link is active (those skip boot auth to avoid blocking workers).
// - Success → 'authenticated'; failure → 'anonymous'.
// - getAuthSession() is used only as warm state (access token for immediate renders),
//   never as final authentication truth.
// - logout is kept SYNC () => void (Task 6.1 will make it async).
// - mapSession does NOT copy refreshToken from the dto.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { agriSyncClient, type AuthResponseDto } from '../../infrastructure/api/AgriSyncClient';
import {
    AUTH_SESSION_CHANGED_EVENT,
    clearAuthSession,
    getAuthSession,
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

// spec: secure-remembered-device-sessions-2026-06-24
export type AuthStatus = 'checking' | 'authenticated' | 'anonymous';

interface AuthContextValue {
    session: AuthSession | null;
    authStatus: AuthStatus;
    isAuthenticated: boolean;
    isLoading: boolean;
    authError: string | null;
    login: (phone: string, password: string) => Promise<void>;
    register: (phone: string, password: string, displayName: string) => Promise<void>;
    logout: () => void;
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

    const syncFromStorage = useCallback(() => {
        setSession(getAuthSession());
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        try {
            const refreshed = await agriSyncClient.refreshSession();
            if (refreshed) {
                setSession(refreshed);
                setAuthError(null);
                setAuthStatus('authenticated');
            } else {
                clearAuthSession();
                setSession(null);
                setAuthStatus('anonymous');
            }
        } catch {
            clearAuthSession();
            setSession(null);
            setAuthStatus('anonymous');
        } finally {
            setIsLoading(false);
        }
    }, []);

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
        // a stale access token from being treated as truth.
        void agriSyncClient.refreshSession().then(refreshed => {
            if (refreshed) {
                setSession(refreshed);
                setAuthStatus('authenticated');
            } else {
                clearAuthSession();
                setSession(null);
                setAuthStatus('anonymous');
            }
        }).catch(() => {
            clearAuthSession();
            setSession(null);
            setAuthStatus('anonymous');
        });
    }, []);

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

    const login = useCallback(async (phone: string, password: string) => {
        setIsLoading(true);
        setAuthError(null);
        try {
            const response = await agriSyncClient.login({
                phone,
                password,
                rememberDevice: false, // UI thread (Task 4.2) wires the checkbox; default false for now
                deviceId: '',          // AgriSyncClient fills this via getOrCreateDeviceId()
                platform: 'web',
            });
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

    // spec: secure-remembered-device-sessions-2026-06-24
    // logout is kept SYNC () => void (Task 6.1 will wire backend logout + make it async).
    // Do not change the signature here — IdentitySection and other callers expect () => void.
    const logout = useCallback(() => {
        clearAuthSession();
        // spec: data-principle-spine-2026-05-05/05.3
        // Drop the in-memory tenant DEK; any subsequent voice-clip seal
        // will re-fetch from the backend under the next authenticated
        // session.
        clearCachedDek();
        // spec: data-principle-spine-2026-05-05/06.5
        // Drop the in-memory consent token; revocation cascades on the
        // next /issue call (server is authoritative).
        clearCachedConsentToken();
        setSession(null);
        setAuthStatus('anonymous');
        setAuthError(null);
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        authStatus,
        isAuthenticated: authStatus === 'authenticated',
        isLoading,
        authError,
        login,
        register,
        logout,
        refresh,
        clearAuthError,
    }), [session, authStatus, isLoading, authError, login, register, logout, refresh, clearAuthError]);

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
