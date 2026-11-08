/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32) - each plot's chosen schedule, live.
 * A Dexie live query over `scheduleSubscriptions`, so a choice the server just sent (another phone's), or one made here,
 * shows without leaving the page. Nothing on the screen moves: the page only reads which schedule a plot follows.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { choiceOf, readPlotChoices, type ScheduleChoice } from './scheduleSubscriptions';

export type PlotScheduleChoices = ReadonlyMap<string, ScheduleChoice>;

const NONE: PlotScheduleChoices = new Map();

export function usePlotScheduleChoices(): PlotScheduleChoices {
    const [choices, setChoices] = useState<PlotScheduleChoices>(NONE);
    useEffect(() => {
        let alive = true;
        let unsubscribe = () => {};
        try {
            const db = getDatabase();
            const sub = liveQuery(() => readPlotChoices(db)).subscribe({
                next: rows => {
                    if (!alive) return;
                    const next = new Map<string, ScheduleChoice>();
                    rows.forEach((row, plotId) => next.set(plotId, choiceOf(row)));
                    setChoices(next);
                },
                error: () => { if (alive) setChoices(NONE); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setChoices(NONE);
        }
        return () => { alive = false; unsubscribe(); };
    }, []);
    return choices;
}
