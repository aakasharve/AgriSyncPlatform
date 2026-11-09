/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 1; D-83 = 1, P11)
 *
 * The pull carries `plotPlanningState`: per plot of the current season, whether it is in the trial, follows a schedule, can follow
 * one, and needs to choose one first. FULL on every pull (the trial ends with no row changing), so it is stored whole in `appMeta`,
 * replacing the last list. A key that is absent (an older server) or is not a list leaves what is there untouched; a row that
 * cannot be read is dropped and the rest are kept. Never throws into the pull.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { parsePlotPlanningStates } from '../../../../infrastructure/api/planningStateDtos';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { writePlanningStates } from '../../../../infrastructure/storage/planningStateStore';

/** Returns true when the list was stored this pull. */
export async function reconcilePlanningState(db: AgriLogDatabase, payload: SyncPullResponse, receivedAtUtc: string): Promise<boolean> {
    const raw = (payload as SyncPullResponse & { plotPlanningState?: unknown }).plotPlanningState;
    if (!Array.isArray(raw)) return false;
    try {
        await writePlanningStates(db, parsePlotPlanningStates(raw), receivedAtUtc);
        return true;
    } catch (error) {
        console.warn(JSON.stringify({
            component: 'planningStateReconciler',
            action: 'planning_state_not_kept_this_pull',
            reason: error instanceof Error ? error.message : String(error),
        }));
        return false;
    }
}
