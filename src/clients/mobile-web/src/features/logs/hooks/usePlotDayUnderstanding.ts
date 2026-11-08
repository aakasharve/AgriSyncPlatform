/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 0b; founder 2026-11-06 "one number score, one place") - the
 * understanding score of ONE PLOT for one day, read from the server (IT3: GET /shramsafal/day-understanding/plots), shown only on
 * the result screen. Like `useDayUnderstanding` it never computes a score: an offline or failed read, a plot the server does not
 * list, or a plot with no score gives `score: null` (the gentle pending line), never an invented number and never a fall-back to
 * another plot's. Self-gated: no farm, no plot, or the meter flag off makes NO network call.
 */
import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { FEATURE_FLAGS } from '../../../app/featureFlags';

export interface UsePlotDayUnderstandingState {
    /** The plot's /10 from the server, or null (offline, failed, unlisted plot, no record that day, no-work day). */
    score: number | null;
    refresh: () => Promise<void>;
}

export function usePlotDayUnderstanding(
    farmId: string | null | undefined,
    plotId: string | null | undefined,
    date?: string,
    /** Bump to refetch after a save or a sync, like `useDayUnderstanding`. */
    refreshKey?: string | null,
): UsePlotDayUnderstandingState {
    const [score, setScore] = useState<number | null>(null);

    const refresh = useCallback(async () => {
        if (!farmId || !plotId || !FEATURE_FLAGS.understandingMeter) {
            setScore(null);
            return;
        }
        try {
            const rows = await agriSyncClient.getPlotDayUnderstanding(farmId, date);
            const mine = rows.find(r => r.plotId?.toLowerCase() === plotId.toLowerCase());
            setScore(typeof mine?.score0to10 === 'number' ? mine.score0to10 : null);
        } catch {
            // Offline / failed: NO number. Never the farm-day score, never a guess.
            setScore(null);
        }
        // refreshKey only changes this callback's identity so the effect below re-runs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [farmId, plotId, date, refreshKey]);

    useEffect(() => { void refresh(); }, [refresh]);

    return { score, refresh };
}
