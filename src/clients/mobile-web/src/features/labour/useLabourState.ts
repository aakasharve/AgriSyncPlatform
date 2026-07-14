/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourState — the Labour feature's data hook. Mirrors the shape of
 * `features/profile/hooks/useFarmAdminState.ts`: screens consume one hook and
 * never touch data plumbing directly.
 *
 * Real backend data loads via a cancellable `useEffect` (`fetchLabourData`),
 * keyed on the current farm.
 *
 * PREVIEW-SAFE FALLBACK: `?preview=labour` mounts `LabourFeature` (via
 * `LabourPreview`) BEFORE any provider tree — see App.tsx's `LABOUR_PREVIEW`
 * branch, which returns before `<FarmContextProvider>` mounts. Calling the
 * throwing `useFarmContext()` there would crash the preview, so this hook
 * uses the non-throwing `useOptionalFarmContext()` instead. When there is no
 * farm context (preview) or no current farm yet, it falls back to
 * `LABOUR_MOCK` — the same contract shape the real fetch produces. This is
 * the ONLY path allowed to show `LABOUR_MOCK`.
 *
 * MONEY-SAFETY (binding): a REAL farm (`farmId` present) must NEVER render
 * `LABOUR_MOCK` — not on first load, not on a fetch error. During a backend
 * outage a real farmer must see an honest empty state (`EMPTY_LABOUR_DATA`,
 * `error: true`), never रोकडे/रमेश/सुनीता and their mock ₹ balances mistaken
 * for their own farm's real data.
 */
import { useCallback, useEffect, useState } from 'react';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA, type LabourData } from './labourMock';
import { fetchLabourData } from './data/labourClient';
import { useOptionalFarmContext } from '../../core/session/FarmContext';

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
    const farmId = farmCtx?.currentFarmId ?? null;

    // Lazy initializer: a real farm's FIRST render already shows the honest
    // empty state, not the mock — no one-frame flash of fake data.
    const [data, setData] = useState<LabourData>(() => (farmId ? EMPTY_LABOUR_DATA : LABOUR_MOCK));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
        if (!farmId) {
            // Preview mode (no provider) or no farm resolved yet — mock fallback.
            // This is the ONLY branch that may show LABOUR_MOCK.
            setData(LABOUR_MOCK);
            setLoading(false);
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
                if (!cancelled) {
                    setData(EMPTY_LABOUR_DATA);
                    setError(true);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [farmId, retryToken]);

    const refresh = useCallback(() => setRetryToken((t) => t + 1), []);

    return { data, loading, error, refresh };
};
