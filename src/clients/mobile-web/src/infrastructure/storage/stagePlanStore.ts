/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 5; P10) - the last stage-plan answer for each plot, kept in
 * `appMeta` (no Dexie version bump; the `plannedWorkAssignees` precedent) so the stage panel still shows something true when there is no
 * net: that answer, with the time the server gave it. One row per plot; a 404 or a refusal removes it (the plot is no longer his to see).
 */
import type { PlotStagePlanDto } from '../api/stagePlanDtos';
import { parsePlotStagePlan } from '../api/stagePlanDtos';
import { getDatabase } from './DexieDatabase';

export const stagePlanMetaKey = (plotId: string): string => `shramsafal_stage_plan_v1:${plotId}`;

export interface StoredStagePlan {
    receivedAtUtc: string;
    plan: PlotStagePlanDto;
}

export async function readCachedStagePlan(plotId: string): Promise<StoredStagePlan | null> {
    try {
        const row = await getDatabase().appMeta.get(stagePlanMetaKey(plotId));
        const value = row?.value as { receivedAtUtc?: unknown; plan?: unknown } | undefined;
        const plan = parsePlotStagePlan(value?.plan);
        return plan && typeof value?.receivedAtUtc === 'string' ? { receivedAtUtc: value.receivedAtUtc, plan } : null;
    } catch {
        return null;
    }
}

export async function saveStagePlan(plotId: string, plan: PlotStagePlanDto): Promise<void> {
    try {
        const receivedAtUtc = new Date().toISOString();
        await getDatabase().appMeta.put({ key: stagePlanMetaKey(plotId), value: { receivedAtUtc, plan }, updatedAt: receivedAtUtc });
    } catch {
        /* a blocked store only means nothing is kept for the next time without a net */
    }
}

export async function dropStagePlan(plotId: string): Promise<void> {
    try {
        await getDatabase().appMeta.delete(stagePlanMetaKey(plotId));
    } catch {
        /* nothing kept to remove */
    }
}
