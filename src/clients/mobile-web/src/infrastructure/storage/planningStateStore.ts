/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b; D-83 = 1, P11) - what the SERVER last said about the planning
 * gate of each plot (`/sync/pull` -> `plotPlanningState`), kept in `appMeta` (no Dexie version bump; the `accessScopeStore.ts`
 * precedent): ONE key, replaced whole by every pull that carries the key. A pull without the key (an older server) leaves it alone.
 * The phone never works the gate out itself: it remembers the server's last answer, and where it has none it asks nothing.
 */
import type { PlotPlanningStateDto } from '../api/planningStateDtos';
import type { AgriLogDatabase } from './DexieDatabase';
import { getDatabase } from './DexieDatabase';

/** `{ receivedAtUtc, states }`. Absent = an older server, or never pulled. */
export const PLOT_PLANNING_STATE_META_KEY = 'shramsafal_plot_planning_state_v1';

export interface StoredPlanningStates {
    receivedAtUtc: string;
    states: PlotPlanningStateDto[];
}

export async function readPlanningStates(db: AgriLogDatabase = getDatabase()): Promise<StoredPlanningStates | null> {
    try {
        const row = await db.appMeta.get(PLOT_PLANNING_STATE_META_KEY);
        const value = row?.value as StoredPlanningStates | undefined;
        return value && Array.isArray(value.states) ? value : null;
    } catch {
        return null; // a blocked store reads as "unknown: ask nothing"
    }
}

/** Replace the whole list (a plot it no longer lists is gone). */
export async function writePlanningStates(db: AgriLogDatabase, states: readonly PlotPlanningStateDto[], receivedAtUtc: string): Promise<void> {
    const value: StoredPlanningStates = { receivedAtUtc, states: [...states] };
    await db.appMeta.put({ key: PLOT_PLANNING_STATE_META_KEY, value, updatedAt: receivedAtUtc });
}
