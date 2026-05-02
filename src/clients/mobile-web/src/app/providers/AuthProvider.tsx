import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { agriSyncClient, type AuthResponseDto } from '../../infrastructure/api/AgriSyncClient';
import {
    AUTH_SESSION_CHANGED_EVENT,
    clearAuthSession,
    getAuthSession,
    setAuthSession,
    type AuthSession
} from '../../infrastructure/storage/AuthTokenStore';

interface AuthContextValue {
    session: AuthSession | null;
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
    const [authError, setAuthError] = useState<string | null>(null);

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
            setAuthError(null);
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
            const response = await agriSyncClient.login({ phone, password });
            const next = mapSession(response);
            setAuthSession(next);
            setSession(next);
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

    const logout = useCallback(() => {
        clearAuthSession();
        setSession(null);
        setAuthError(null);
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        isAuthenticated: !!session?.accessToken,
        isLoading,
        authError,
        login,
        register,
        logout,
        refresh,
        clearAuthError,
    }), [session, isLoading, authError, login, register, logout, refresh, clearAuthError]);

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
