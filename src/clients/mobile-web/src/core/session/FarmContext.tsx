/**
 * FarmContext — real farm context backed by /user/auth/me/context.
 * Replaces the ad-hoc per-page /farms/mine polling introduced in Phase 6.
 *
 * Key behaviours:
 *   - Fetches on mount and after login.
 *   - 2-minute in-memory TTL (MeContextService).
 *   - `currentFarmId` persists to localStorage; always falls back to first farm.
 *   - `switchFarm` updates localStorage + triggers a context refresh.
 *
 * Multi-tenant plan §6.2.1.
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
    type MeMembership,
} from './MeContextService';
import { useAuth } from '../../app/providers/AuthProvider';

const CURRENT_FARM_KEY = 'shramsafal_current_farm_id';

interface FarmContextValue {
    meContext: MeContext | null;
    isLoading: boolean;
    currentFarmId: string | null;
    currentMembership: MeMembership | null;
    allMemberships: MeMembership[];
    switchFarm: (farmId: string) => void;
    refresh: () => Promise<void>;
}

const FarmCtx = createContext<FarmContextValue | null>(null);

export const FarmContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [meContext, setMeContext] = useState<MeContext | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentFarmId, setCurrentFarmId] = useState<string | null>(
        () => localStorage.getItem(CURRENT_FARM_KEY),
    );

    const refresh = useCallback(async (force = false) => {
        if (!isAuthenticated) return;
        setIsLoading(true);
        try {
            const ctx = await fetchMeContext({ force });
            setMeContext(ctx);
            // Ensure currentFarmId points to a real membership.
            const ids = ctx.memberships.map(m => m.farmId);
            setCurrentFarmId(prev => {
                const valid = prev && ids.includes(prev) ? prev : (ids[0] ?? null);
                if (valid) localStorage.setItem(CURRENT_FARM_KEY, valid);
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
        localStorage.setItem(CURRENT_FARM_KEY, farmId);
    }, []);

    const allMemberships = meContext?.memberships ?? [];
    const currentMembership = useMemo(
        () => allMemberships.find(m => m.farmId === currentFarmId) ?? allMemberships[0] ?? null,
        [allMemberships, currentFarmId],
    );

    const value = useMemo<FarmContextValue>(() => ({
        meContext,
        isLoading,
        currentFarmId,
        currentMembership,
        allMemberships,
        switchFarm,
        refresh: () => refresh(true),
    }), [meContext, isLoading, currentFarmId, currentMembership, allMemberships, switchFarm, refresh]);

    return <FarmCtx.Provider value={value}>{children}</FarmCtx.Provider>;
};

export function useFarmContext(): FarmContextValue {
    const ctx = useContext(FarmCtx);
    if (!ctx) throw new Error('useFarmContext must be used inside FarmContextProvider');
    return ctx;
}
