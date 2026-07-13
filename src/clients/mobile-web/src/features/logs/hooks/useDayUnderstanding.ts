/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useDayUnderstanding — read-only hook over GET /shramsafal/day-understanding.
 * Fetches the farmer-facing Day Understanding Score (X/10) — the ASSISTANT's
 * understanding of the active farm's day — for one farm + date. The FETCH is
 * gated on FEATURE_FLAGS.understandingMeter (the /10 display gate): with it OFF
 * — the production default — this hook issues ZERO network calls, so it is safe
 * to call unconditionally at the top of MeterDisplay before its flag early-exit.
 *
 * On a null score OR any fetch failure (offline / server error) the hook yields
 * `score: null`. It deliberately does NOT fall back to the client-side scoreVlog
 * /100 engine: that number is a DIFFERENT scorer than the server lenses and would
 * diverge, so a gentle "still understanding" pending state is shown instead —
 * consistency over immediacy. spec: dfes-companion-2026-07-11
 */
import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { FEATURE_FLAGS } from '../../../app/featureFlags';

export interface UseDayUnderstandingState {
    /** 0–10 server score, or null when not-enough-understood / offline / failed. */
    score: number | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useDayUnderstanding(
    farmId: string | null | undefined,
    date?: string,
): UseDayUnderstandingState {
    const [score, setScore] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!farmId || !FEATURE_FLAGS.understandingMeter) {
            setScore(null);
            setError(null);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const dto = await agriSyncClient.getDayUnderstanding(farmId, date);
            setScore(dto.score ?? null);
        } catch (loadError) {
            // Offline / failed → NO number (gentle pending). Intentionally do NOT
            // fall back to the client scoreVlog /100 — that diverges from the
            // server /10 and would be inconsistent.
            setError(loadError instanceof Error ? loadError.message : 'Failed to load day understanding.');
            setScore(null);
        } finally {
            setIsLoading(false);
        }
    }, [farmId, date]);

    useEffect(() => { void refresh(); }, [refresh]);

    return { score, isLoading, error, refresh };
}
