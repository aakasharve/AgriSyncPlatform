/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32) - each plot's chosen schedule, live.
 * A Dexie live query over `scheduleSubscriptions`, so a choice the server just sent (another phone's), or one made here,
 * shows without leaving the page. Nothing on the screen moves: the page only reads which schedule a plot follows.
 * spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - each plot's choice is its मुख्य schedule (what the header, the stage line and the tabs
 * follow) with EVERY schedule it follows attached in place order (`choice.followed`).
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { choiceForPlot, currentCycleByPlot, readFollowedByPlot, type ScheduleChoice } from './scheduleSubscriptions';

export type PlotScheduleChoices = ReadonlyMap<string, ScheduleChoice>;

const NONE: PlotScheduleChoices = new Map();

export function usePlotScheduleChoices(): PlotScheduleChoices {
    const [choices, setChoices] = useState<PlotScheduleChoices>(NONE);
    useEffect(() => {
        let alive = true;
        let unsubscribe = () => {};
        try {
            const db = getDatabase();
            const sub = liveQuery(async () => ({ followed: await readFollowedByPlot(db), current: await currentCycleByPlot(db) })).subscribe({
                next: rows => {
                    if (!alive) return;
                    const next = new Map<string, ScheduleChoice>();
                    rows.followed.forEach((followed, plotId) => {
                        const choice = choiceForPlot(followed, rows.current.get(plotId));
                        if (choice) next.set(plotId, choice);
                    });
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
