/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2; founder 2026-11-06 "one number score, one place") - the
 * server's one "tell more" line for each plot of one day (IT3: GET /shramsafal/day-understanding/plots), for the plot cards of
 * पूर्ण शेतीचा आढावा.
 *
 * It reads the WORDS and nothing else: the plot rows also carry a score, which this hook never reads, keeps or returns - the
 * only number on any screen is the understanding meter on the result screen. Offline, a failed read, or a plot the server does
 * not list gives no line: nothing is made up (P4). Self-gated like the result screen's plot meter: no farm, a day other than
 * today's, or the companion flag off makes NO network call.
 */
import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { FEATURE_FLAGS } from '../../../app/featureFlags';

/** The line in both languages, as the server sends it. */
export interface PlotHintText { mr: string; en: string }

export interface UsePlotUnderstanding {
    /** The "tell more" line of this plot in the language, or `null` (none listed, none to say, offline). */
    hintFor: (plotId: string | null | undefined, language?: string | null) => string | null;
}

const clean = (text: unknown): string => (typeof text === 'string' ? text.trim() : '');

export function usePlotUnderstanding(
    farmId: string | null | undefined,
    dateKey: string,
    /** False = do not ask (the line is offered on today only). */
    enabled: boolean,
    /** Changes when the day's records change, so the line is asked for again. */
    refreshKey?: string | null,
): UsePlotUnderstanding {
    const [hints, setHints] = useState<ReadonlyMap<string, PlotHintText>>(() => new Map());
    // A pull that brought new records (or the server's own answers) asks again.
    const [pulled, setPulled] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onPulled = () => setPulled(n => n + 1);
        window.addEventListener('agrisync:sync-reconciled', onPulled);
        return () => window.removeEventListener('agrisync:sync-reconciled', onPulled);
    }, []);

    const load = useCallback(async (isCurrent: () => boolean) => {
        if (!farmId || !enabled || !FEATURE_FLAGS.understandingMeter) {
            setHints(new Map());
            return;
        }
        try {
            const rows = await agriSyncClient.getPlotDayUnderstanding(farmId, dateKey);
            if (!isCurrent()) return;
            const next = new Map<string, PlotHintText>();
            for (const row of rows) {
                const mr = clean(row.nextHint?.mr);
                const en = clean(row.nextHint?.en);
                if (row.plotId && (mr || en)) next.set(row.plotId.toLowerCase(), { mr, en });
            }
            setHints(next);
        } catch {
            // Offline / failed: no line at all. Never a stale one, never a guess.
            if (isCurrent()) setHints(new Map());
        }
    }, [farmId, dateKey, enabled]);

    useEffect(() => {
        let current = true;
        void load(() => current);
        return () => { current = false; };
        // refreshKey / pulled only re-run the read.
    }, [load, refreshKey, pulled]);

    const hintFor = useCallback((plotId: string | null | undefined, language?: string | null): string | null => {
        const row = plotId ? hints.get(plotId.toLowerCase()) : undefined;
        if (!row) return null;
        // One language at a time: English mode says the English line only; any other language reads Marathi.
        return (language === 'en' ? row.en : row.mr) || null;
    }, [hints]);

    return { hintFor };
}
