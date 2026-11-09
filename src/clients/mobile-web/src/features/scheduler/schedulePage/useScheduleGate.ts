/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 3; D-83 = 1, open point 9 (a)(b), P10, P11)
 *
 * What the server said about each plot's planning gate (`plotPlanningState`, kept in `appMeta` by the pull) laid beside what this phone
 * holds right now, live:
 *   - `needsSchedule(plotId)` - the server says NeedsSchedule AND this phone holds no choice for the plot (a choice made here, still
 *     unanswered, counts at once: P10) AND the state is about the season this phone shows. Where the server said nothing - an older
 *     server, a plot it does not list, a store that cannot be read - it is false: "unknown, ask nothing".
 *   - `inTrial(plotId)` / `stateOf(plotId)` - for the trial view.
 *
 * Read ONLY by the places D-83 = 1 allows to ask: new planning, the शेड्यूल page (and, later, तुलना). A record door (the log page, the
 * mic, हजेरी, खरेदी, मंजूर, a handed-out task, "काम झालं") never imports this - `features/plannedWork/__tests__/scheduleGate.doors.router.test.tsx` scans for it.
 */
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import type { PlotPlanningStateDto } from '../../../infrastructure/api/planningStateDtos';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { readPlanningStates } from '../../../infrastructure/storage/planningStateStore';
import { currentCycleByPlot, readFollowedByPlot } from './scheduleSubscriptions';

export interface ScheduleGate {
    /** The first read has come back (before it, nothing asks). */
    loaded: boolean;
    stateOf: (plotId: string) => PlotPlanningStateDto | undefined;
    needsSchedule: (plotId: string) => boolean;
    inTrial: (plotId: string) => boolean;
}

interface Snapshot {
    loaded: boolean;
    states: ReadonlyMap<string, PlotPlanningStateDto>;
    holding: ReadonlySet<string>;
    current: ReadonlyMap<string, string>;
}

const EMPTY: Snapshot = { loaded: false, states: new Map(), holding: new Set(), current: new Map() };

export function useScheduleGate(): ScheduleGate {
    const [snap, setSnap] = useState<Snapshot>(EMPTY);
    useEffect(() => {
        let alive = true;
        let unsubscribe = () => {};
        try {
            const db = getDatabase();
            const sub = liveQuery(async () => ({
                kept: await readPlanningStates(db),
                followed: await readFollowedByPlot(db),
                current: await currentCycleByPlot(db),
            })).subscribe({
                next: rows => {
                    if (!alive) return;
                    setSnap({
                        loaded: true,
                        states: new Map((rows.kept?.states ?? []).map(s => [s.plotId, s])),
                        holding: new Set(rows.followed.keys()),
                        current: rows.current,
                    });
                },
                error: () => { if (alive) setSnap({ ...EMPTY, loaded: true }); },
            });
            unsubscribe = () => sub.unsubscribe();
        } catch {
            setSnap({ ...EMPTY, loaded: true });
        }
        return () => { alive = false; unsubscribe(); };
    }, []);

    return useMemo<ScheduleGate>(() => {
        // The state is about one season; where this phone shows another, it says nothing about this one.
        const forThisSeason = (plotId: string): PlotPlanningStateDto | undefined => {
            const state = snap.states.get(plotId);
            const shown = snap.current.get(plotId);
            if (state && state.cropCycleId && shown && state.cropCycleId !== shown) return undefined;
            return state;
        };
        return {
            loaded: snap.loaded,
            stateOf: forThisSeason,
            needsSchedule: plotId => snap.loaded && forThisSeason(plotId)?.needsSchedule === true && !snap.holding.has(plotId),
            inTrial: plotId => snap.loaded && forThisSeason(plotId)?.inTrial === true,
        };
    }, [snap]);
}
