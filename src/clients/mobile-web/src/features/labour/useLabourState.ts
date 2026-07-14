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
 * `LABOUR_MOCK` — the same contract shape the real fetch produces.
 */
import { useEffect, useState } from 'react';
import { LABOUR_MOCK, type LabourData } from './labourMock';
import { fetchLabourData } from './data/labourClient';
import { useOptionalFarmContext } from '../../core/session/FarmContext';

export interface UseLabourStateResult {
    data: LabourData;
    loading: boolean;
}

export const useLabourState = (): UseLabourStateResult => {
    const farmCtx = useOptionalFarmContext();
    const farmId = farmCtx?.currentFarmId ?? null;

    const [data, setData] = useState<LabourData>(LABOUR_MOCK);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!farmId) {
            // Preview mode (no provider) or no farm resolved yet — mock fallback.
            setData(LABOUR_MOCK);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const real = await fetchLabourData(farmId);
                if (!cancelled) setData(real);
            } catch {
                // Silent — mirrors useFarmAdminState's lazy-loader: keep the
                // previous data (mock or the last successfully fetched farm)
                // rather than surfacing a broken screen.
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [farmId]);

    return { data, loading };
};
