/**
 * FarmContext — real farm context backed by /user/auth/me/context.
 *
 * Key behaviours:
 *   - Fetches on mount and after login.
 *   - 2-minute in-memory TTL (MeContextService).
 *   - `currentFarmId` persists to localStorage; always falls back to first farm.
 *   - `switchFarm` updates localStorage + triggers a context refresh.
 *
 * Shape matches spec 2026-04-20-user-is-multitenant-base: pre-computed
 * capabilities and alerts so consumers render, never compute.
 */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import {
    fetchMeContext,
    invalidateMeContext,
    type MeContext,
    type MeFarm,
} from './MeContextService';
import { useAuth } from '../../app/providers/AuthProvider';
import { SessionStore } from '../../infrastructure/storage/SessionStore';

interface FarmContextValue {
    meContext: MeContext | null;
    isLoading: boolean;
    currentFarmId: string | null;
    currentFarm: MeFarm | null;
    farms: MeFarm[];
    switchFarm: (farmId: string) => void;
    refresh: () => Promise<void>;
}

const FarmCtx = createContext<FarmContextValue | null>(null);

export const FarmContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [meContext, setMeContext] = useState<MeContext | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentFarmId, setCurrentFarmId] = useState<string | null>(
        () => SessionStore.getCurrentFarmId(),
    );

    const refresh = useCallback(async (force = false) => {
        if (!isAuthenticated) return;
        setIsLoading(true);
        try {
            const ctx = await fetchMeContext({ force });
            setMeContext(ctx);
            const ids = ctx.farms.map(f => f.farmId);
            setCurrentFarmId(prev => {
                const valid = prev && ids.includes(prev) ? prev : (ids[0] ?? null);
                if (valid) SessionStore.setCurrentFarmId(valid);
                return valid;
            });
        } catch {
            // silently keep stale data
        } finally {
            setIsLoading(false);
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (isAuthenticated) {
            void refresh();
        } else {
            setMeContext(null);
            invalidateMeContext();
        }
    }, [isAuthenticated, refresh]);

    const switchFarm = useCallback((farmId: string) => {
        setCurrentFarmId(farmId);
        SessionStore.setCurrentFarmId(farmId);
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- T-IGH-04 ratchet: dep array intentionally narrow (mount/farm/init pattern); revisit in V2.
    const farms = meContext?.farms ?? [];
    const currentFarm = useMemo(
        () => farms.find(f => f.farmId === currentFarmId) ?? farms[0] ?? null,
        [farms, currentFarmId],
    );

    const value = useMemo<FarmContextValue>(() => ({
        meContext,
        isLoading,
        currentFarmId,
        currentFarm,
        farms,
        switchFarm,
        refresh: () => refresh(true),
    }), [meContext, isLoading, currentFarmId, currentFarm, farms, switchFarm, refresh]);

    return <FarmCtx.Provider value={value}>{children}</FarmCtx.Provider>;
};

export function useFarmContext(): FarmContextValue {
    const ctx = useContext(FarmCtx);
    if (!ctx) throw new Error('useFarmContext must be used inside FarmContextProvider');
    return ctx;
}
