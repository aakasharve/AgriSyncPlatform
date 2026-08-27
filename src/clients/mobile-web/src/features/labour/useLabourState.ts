/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourState — the Labour feature's data hook. Mirrors the shape of
 * `features/profile/hooks/useFarmAdminState.ts`: screens consume one hook and
 * never touch data plumbing directly.
 *
 * Real backend data loads via a cancellable `useEffect` (`fetchLabourData`),
 * keyed on the current farm AND on auth having settled.
 *
 * AUTH GATE (BUG 1, 2026-08-10): `currentFarmId` is seeded from localStorage
 * (`SessionStore.getCurrentFarmId()`), so a farm id exists on the very first
 * render — BEFORE `AuthProvider`'s boot `refreshSession()` has put an access
 * token back in memory (the token is in-memory only; a page load starts with
 * none — see `infrastructure/storage/AuthTokenStore.ts`). Firing the fetch on
 * "farm id exists" alone therefore sent an unauthenticated request that 401'd,
 * and the hook latched `error = true` and never retried itself: the farmer
 * landed on "माहिती आणता आली नाही" and had to tap "पुन्हा प्रयत्न करा" to see
 * his own workers. Our target user cannot diagnose that — he concludes the app
 * is broken. So: no fetch until auth has definitively settled AND an access
 * token is actually available. The effect re-runs the moment that flips.
 *
 * A 401 that happens ANYWAY (token expired mid-session — access tokens are
 * short-lived) self-heals one layer down: `fetchLabourData` goes through the
 * shared `agriSyncClient.http`, whose response interceptor refreshes the
 * session once and replays the request. This hook deliberately does NOT
 * hand-roll a second refresh-and-retry on top of it.
 *
 * PREVIEW-SAFE FALLBACK: `?preview=labour` mounts `LabourFeature` (via
 * `LabourPreview`) BEFORE any provider tree — see App.tsx's `LABOUR_PREVIEW`
 * branch, which returns before `<FarmContextProvider>` mounts. Calling the
 * throwing `useFarmContext()` there would crash the preview, so this hook
 * uses the non-throwing `useOptionalFarmContext()` instead, which returns
 * `null` ONLY when there is no provider at all (preview). `LABOUR_MOCK` is
 * gated on that `null` — it is NOT used just because `currentFarmId` happens
 * to be null. This is the ONLY path allowed to show `LABOUR_MOCK`.
 *
 * MONEY-SAFETY (binding): a REAL farm (provider present) must NEVER render
 * `LABOUR_MOCK` — not on first load, not while `currentFarmId` is still
 * resolving (FarmContext loading), not on a fetch error. In every one of
 * those real-app cases the farmer must see an honest empty state
 * (`EMPTY_LABOUR_DATA`), never रोकडे/रमेश/सुनीता and their mock ₹ balances
 * mistaken for their own farm's real data.
 */
import { useCallback, useEffect, useState } from 'react';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA, type LabourData } from './labourMock';
import { fetchLabourData } from './data/labourClient';
import { useOptionalFarmContext } from '../../core/session/FarmContext';
import { useOptionalAuth } from '../../app/providers/AuthProvider';

export interface UseLabourStateResult {
    data: LabourData;
    loading: boolean;
    /** true only when a REAL farm's fetch failed — `data` is `EMPTY_LABOUR_DATA`, never mock. */
    error: boolean;
    /** Re-runs the fetch for the current farm (retry affordance). No-op in preview. */
    refresh: () => void;
}

export const useLabourState = (): UseLabourStateResult => {
    const farmCtx = useOptionalFarmContext();
    const isPreview = farmCtx === null; // no provider at all — the ONLY mock case
    const farmId = farmCtx?.currentFarmId ?? null;
    const farmCtxLoading = farmCtx?.isLoading ?? false;

    // --- Auth gate (see the AUTH GATE note in this file's header) ----------
    // `auth === null` means there is no AuthProvider ABOVE this hook at all.
    // In the real app that never happens (App.tsx mounts AuthProvider above
    // FarmContextProvider above every route), so the gate always applies where
    // it matters. It is `null` only in an unprovisioned shell — the
    // `?preview=labour` mount, which never fetches anyway, and this hook's own
    // unit tests. There is nothing pending to wait for in that case, so the
    // gate opens rather than deadlocking on a provider that will never appear.
    const auth = useOptionalAuth();
    /** True once auth has settled AND an access token is actually in memory. */
    const authReady = auth === null
        ? true
        : auth.authStatus === 'authenticated' && Boolean(auth.session?.accessToken);
    /** True while the boot refresh is still deciding — an honest "loading", not an error. */
    const authPending = auth !== null
        && (auth.authStatus === 'checking'
            // Authenticated but the token hasn't landed in memory yet: still
            // in flight, not a failure. Do not fetch, do not show an error.
            || (auth.authStatus === 'authenticated' && !auth.session?.accessToken));

    // Lazy initializer: preview is the ONLY case that starts with the mock.
    // A real app (provider present) always starts honest, even before its
    // farm has resolved — no one-frame flash of fake data.
    const [data, setData] = useState<LabourData>(() => (isPreview ? LABOUR_MOCK : EMPTY_LABOUR_DATA));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        if (isPreview) {
            // No provider at all (preview) — mock fallback.
            // This is the ONLY branch that may show LABOUR_MOCK.
            setData(LABOUR_MOCK);
            setLoading(false);
            setError(false);
            return;
        }

        if (!farmId) {
            // Real app, but no farm resolved yet — FarmContext may still be
            // loading, or the farmer genuinely has no farm. Either way: the
            // honest empty state, NEVER the mock.
            setData(EMPTY_LABOUR_DATA);
            setLoading(farmCtxLoading);
            setError(false);
            return;
        }

        if (!authReady) {
            // BUG 1: a farm id exists (it is restored from localStorage on the
            // first render) but auth has NOT settled — the in-memory access
            // token may not have been re-minted yet. Fetching now guarantees a
            // 401 and a dead error screen. Wait instead; this effect re-runs
            // the instant `authReady` flips.
            //
            // MONEY-SAFETY: still the honest empty state, never the mock.
            // `authPending` (boot refresh in flight) is a genuine "loading";
            // an `anonymous` result is not an error the farmer can act on —
            // the app routes him to the login screen for that.
            setData(EMPTY_LABOUR_DATA);
            setLoading(authPending);
            setError(false);
            return;
        }

        let cancelled = false;
        // Real farm: never let a stale mock (or a previous farm's data) sit
        // on screen while this loads — show the honest empty state instead.
        setData(EMPTY_LABOUR_DATA);
        setLoading(true);
        setError(false);
        (async () => {
            try {
                const real = await fetchLabourData(farmId);
                if (!cancelled) {
                    setData(real);
                    setError(false);
                }
            } catch {
                // MONEY-SAFETY: a real farm's fetch error NEVER falls back to
                // LABOUR_MOCK. Keep the honest empty state and surface
                // `error` so the UI can show a retry affordance instead of
                // silently presenting fake workers/money as real.
                //
                // By the time we land here the shared client has ALREADY spent
                // its one 401-refresh-and-replay attempt, so this is a genuine
                // failure (server down, session truly gone) — exactly the case
                // the manual "पुन्हा प्रयत्न करा" button is for.
                if (!cancelled) {
                    setData(EMPTY_LABOUR_DATA);
                    setError(true);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isPreview, farmId, farmCtxLoading, authReady, authPending, retryToken]);

    const refresh = useCallback(() => setRetryToken((t) => t + 1), []);

    return { data, loading, error, refresh };
};
