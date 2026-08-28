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
    /**
     * Task 6f (spec: 2026-08-28-labour-v2-release-1) — this reference is NOT
     * memo-stable: it is rebuilt inside the `value` `useMemo` below, whose
     * deps include `isLoading` and `meContext`, both of which change at
     * least twice per `/me` call (once when the fetch starts, again when it
     * settles). So `refresh` gets a new identity on every fetch cycle, not
     * just on the renders that actually change what it does.
     *
     * That must stay true for every consumer to call it imperatively
     * (`onClick`, or — per Task 6e — from inside `useLabourState`'s own
     * `refresh`) and NEVER put it in a `useEffect` dependency array: an
     * effect keyed on this identity would re-fire on every fetch it
     * triggers, i.e. loop. Nothing does that today, but `useLabourState`'s
     * retry wiring now reads this reference to make its own retry work
     * (Task 6e) — so an accidental future stabilisation of this into a
     * fixed reference is not a free simplification either; anything that
     * changes when this identity changes needs re-checking against both
     * directions.
     */
    refresh: () => Promise<void>;
    /**
     * Task 6e (spec: 2026-08-28-labour-v2-release-1, P5, Ruling R8) — true
     * when the LAST `/me` attempt threw. PURELY ADDITIVE: the swallow below
     * is unchanged and deliberate (other screens legitimately keep stale
     * data through a failed refresh), so no existing consumer's behaviour
     * moves. This only makes the failure *visible* to the consumers that
     * need to tell "we could not find out" apart from "there is nothing".
     *
     * Why that distinction is not cosmetic: on a fresh install there is no
     * cached `currentFarmId`, so a failed `/me` settles as
     * `currentFarmId: null, isLoading: false` — indistinguishable from an
     * account that genuinely has no farm. The labour screen read that as an
     * answer and told a farmer he had no workers when he may have twelve
     * (see `useLabourState.ts`). Absence of any record means unknown; a
     * record that exists and contains nothing is a real, honest empty.
     *
     * NOT a general "is the app offline" flag, and not a licence to blank a
     * screen: consumers that are content with stale data should keep
     * ignoring it.
     */
    loadFailed: boolean;
}

const FarmCtx = createContext<FarmContextValue | null>(null);

export const FarmContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const [meContext, setMeContext] = useState<MeContext | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentFarmId, setCurrentFarmId] = useState<string | null>(
        () => SessionStore.getCurrentFarmId(),
    );
    // Task 6e — see the `loadFailed` note on FarmContextValue.
    const [loadFailed, setLoadFailed] = useState(false);

    const refresh = useCallback(async (force = false) => {
        if (!isAuthenticated) return;
        setIsLoading(true);
        try {
            const ctx = await fetchMeContext({ force });
            setLoadFailed(false);
            setMeContext(ctx);
            const ids = ctx.farms.map(f => f.farmId);
            setCurrentFarmId(prev => {
                const valid = prev && ids.includes(prev) ? prev : (ids[0] ?? null);
                if (valid) SessionStore.setCurrentFarmId(valid);
                return valid;
            });
        } catch {
            // silently keep stale data — UNCHANGED (Task 6e touched nothing
            // here but the flag): consumers that are happy with a stale farm
            // list must not be blanked by a failed refresh. The flag simply
            // stops the failure from being invisible to the ones that must
            // not mistake it for an answer.
            setLoadFailed(true);
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

    const farms = useMemo(() => meContext?.farms ?? [], [meContext]);
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
        loadFailed,
    }), [meContext, isLoading, currentFarmId, currentFarm, farms, switchFarm, refresh, loadFailed]);

    return <FarmCtx.Provider value={value}>{children}</FarmCtx.Provider>;
};

export function useFarmContext(): FarmContextValue {
    const ctx = useContext(FarmCtx);
    if (!ctx) throw new Error('useFarmContext must be used inside FarmContextProvider');
    return ctx;
}

/**
 * The raw context object, exposed for consumers that need the non-throwing
 * accessor below (or their own `useContext(FarmContext)` call).
 */
export { FarmCtx as FarmContext };

/**
 * SAFE optional accessor — returns `null` instead of throwing when there is
 * no `FarmContextProvider` in the tree (e.g. a dev preview mounted directly
 * into `#root`, like `?preview=labour` → `LabourPreview`, which is rendered
 * BEFORE any provider — see App.tsx's `LABOUR_PREVIEW` branch). Use this from
 * any hook that must also work in an unprovisioned preview shell; use
 * `useFarmContext()` everywhere else in the real app.
 */
export function useOptionalFarmContext(): FarmContextValue | null {
    return useContext(FarmCtx);
}
