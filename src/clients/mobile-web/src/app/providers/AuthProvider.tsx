import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { agriSyncClient, type AuthResponseDto } from '../../infrastructure/api/AgriSyncClient';
import { clearAuthSession, getAuthSession, setAuthSession, type AuthSession } from '../../infrastructure/api/AuthTokenStore';

interface AuthContextValue {
    session: AuthSession | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    loginError: string | null;
    login: (phone: string, password: string) => Promise<void>;
    logout: () => void;
    refresh: () => Promise<void>;
    bypassLogin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapSession(dto: AuthResponseDto): AuthSession {
    return {
        userId: dto.userId,
        accessToken: dto.accessToken,
        refreshToken: dto.refreshToken,
        expiresAtUtc: dto.expiresAtUtc,
    };
}

function hasSessionExpired(session: AuthSession): boolean {
    const expiresAtMs = Date.parse(session.expiresAtUtc);
    if (Number.isNaN(expiresAtMs)) {
        return true;
    }

    return expiresAtMs <= Date.now();
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<AuthSession | null>(() => getAuthSession());
    const [isLoading, setIsLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    const syncFromStorage = useCallback(() => {
        setSession(getAuthSession());
    }, []);

    const refresh = useCallback(async () => {
        const current = getAuthSession();
        if (!current?.refreshToken) {
            clearAuthSession();
            setSession(null);
            return;
        }

        setIsLoading(true);
        try {
            const refreshed = await agriSyncClient.refreshToken(current.refreshToken);
            const next = mapSession(refreshed);
            setAuthSession(next);
            setSession(next);
            setLoginError(null);
        } catch {
            clearAuthSession();
            setSession(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const current = getAuthSession();
        if (!current) {
            return;
        }

        if (hasSessionExpired(current)) {
            void refresh();
            return;
        }

        setSession(current);
    }, [refresh]);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (!event.key || event.key.includes('agrisync_auth_session_v1')) {
                syncFromStorage();
            }
        };

        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [syncFromStorage]);

    const login = useCallback(async (phone: string, password: string) => {
        setIsLoading(true);
        setLoginError(null);
        try {
            const response = await agriSyncClient.login({ phone, password });
            const next = mapSession(response);
            setAuthSession(next);
            setSession(next);
        } catch (error) {
            console.error('[AuthProvider] Login failed', error);
            setLoginError('Login failed. Check phone/password and try again.');
            throw error;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const logout = useCallback(() => {
        clearAuthSession();
        setSession(null);
        setLoginError(null);
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        isAuthenticated: !!session?.accessToken,
        isLoading,
        loginError,
        login,
        logout,
        refresh,
        bypassLogin: useCallback(async () => {
            // DEBUG ONLY: Bypass login for testing "Real Mode" without backend
            const dummySession: AuthSession = {
                userId: 'debug-user-id',
                accessToken: 'debug-access-token',
                refreshToken: 'debug-refresh-token',
                expiresAtUtc: new Date(Date.now() + 3600 * 1000).toISOString()
            };
            setAuthSession(dummySession);
            setSession(dummySession);
        }, []),
    }), [session, isLoading, loginError, login, logout, refresh]);

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
