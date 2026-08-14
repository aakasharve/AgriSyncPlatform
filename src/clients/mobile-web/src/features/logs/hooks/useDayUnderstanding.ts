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
 *
 * BUGFIX_2026-07-19: the score is computed server-side as part of saving the
 * log, so a fetch fired at mount time can race that save and land on a
 * not-yet-updated score — with only a `[farmId, date]`-keyed effect (both
 * commonly unchanged across saves on the same day), that first fetch was the
 * ONLY attempt ever made. `refreshKey` is an optional extra dependency (e.g.
 * the just-saved log's id) the caller can bump to re-run the SAME fetch after
 * a save completes, without introducing any polling loop. Omitting it keeps
 * this hook byte-equivalent to before.
 */
import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { FEATURE_FLAGS } from '../../../app/featureFlags';

export interface UseDayUnderstandingState {
    /** 0–10 server score, or null when not-enough-understood / offline / failed. */
    score: number | null;
    /**
     * The day's STORED DayClassification as the server recorded it (e.g.
     * 'DeclaredNoWorkDay', 'BasicWorkDay'), or null when the server has no
     * aggregate for the day / the fetch failed / the meter flag is OFF. Passed
     * through untouched — never derived here (P4/P8). spec:
     * dfes-farmer-facing-deploy-readiness-2026-08-14 (Task 6).
     */
    classification: string | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useDayUnderstanding(
    farmId: string | null | undefined,
    date?: string,
    // BUGFIX_2026-07-19 — bump this (e.g. to the newly-saved log's id) to force
    // a refetch after a save, even when farmId/date are unchanged. Optional;
    // undefined is a no-op extra dependency.
    refreshKey?: string | null,
): UseDayUnderstandingState {
    const [score, setScore] = useState<number | null>(null);
    const [classification, setClassification] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!farmId || !FEATURE_FLAGS.understandingMeter) {
            setScore(null);
            setClassification(null);
            setError(null);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const dto = await agriSyncClient.getDayUnderstanding(farmId, date);
            setScore(dto.score ?? null);
            setClassification(dto.classification ?? null);
        } catch (loadError) {
            // Offline / failed → NO number (gentle pending). Intentionally do NOT
            // fall back to the client scoreVlog /100 — that diverges from the
            // server /10 and would be inconsistent.
            setError(loadError instanceof Error ? loadError.message : 'Failed to load day understanding.');
            setScore(null);
            // …and NO classification either. Guessing "it must have been a no-work
            // day" from a failed fetch would be a fabricated fact about the day.
            setClassification(null);
        } finally {
            setIsLoading(false);
        }
        // refreshKey is intentionally in the deps (not read inside the callback
        // body) — it exists solely to force this callback's identity to change,
        // which re-runs the effect below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [farmId, date, refreshKey]);

    useEffect(() => { void refresh(); }, [refresh]);

    return { score, classification, isLoading, error, refresh };
}
