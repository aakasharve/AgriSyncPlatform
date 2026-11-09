/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 5; D-99, R10, R28; P4, P10, P11) - the phone client of
 * `GET /shramsafal/farms/{farmId}/plots/{plotId}/stage-plan` (the server answers for today; it counts, the phone only shows).
 *
 *   - an answer that reads is shown and kept per plot (`stagePlanStore`);
 *   - no net (the device says so, or the request never arrived): the kept answer with the time it was received, else "offline";
 *   - a 404 or a 403 (the plot is not his to see - the server never reveals which): NOTHING is drawn and what was kept is forgotten;
 *   - any other error, or an answer that cannot be read: NOTHING is drawn - never a fake, never a panel with a number missing.
 * A plot the phone holds no farm for is not asked at all.
 */
import { useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { parsePlotStagePlan, type PlotStagePlanDto } from '../../../infrastructure/api/stagePlanDtos';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { dropStagePlan, readCachedStagePlan, saveStagePlan } from '../../../infrastructure/storage/stagePlanStore';

export const stagePlanPath = (farmId: string, plotId: string): string => `/shramsafal/farms/${farmId}/plots/${plotId}/stage-plan`;

export type StagePlanResult =
    | { kind: 'plan'; plan: PlotStagePlanDto; source: 'server' | 'cache'; receivedAtUtc: string }
    | { kind: 'offline' }
    | { kind: 'none' };

const NONE: StagePlanResult = { kind: 'none' };

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

export async function loadStagePlan(plotId: string): Promise<StagePlanResult> {
    let farmId: string | undefined;
    try {
        farmId = (await getDatabase().plots.get(plotId))?.farmId;
    } catch {
        farmId = undefined;
    }
    if (!farmId) return NONE;

    const keptOrOffline = async (): Promise<StagePlanResult> => {
        const kept = await readCachedStagePlan(plotId);
        return kept ? { kind: 'plan', plan: kept.plan, source: 'cache', receivedAtUtc: kept.plan.serverTimeUtc || kept.receivedAtUtc } : { kind: 'offline' };
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return keptOrOffline();
    try {
        const response = await agriSyncClient.http.get<unknown>(stagePlanPath(farmId, plotId));
        const plan = parsePlotStagePlan(response.data);
        if (!plan) return NONE;
        await saveStagePlan(plotId, plan);
        return { kind: 'plan', plan, source: 'server', receivedAtUtc: plan.serverTimeUtc };
    } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 403) {
            await dropStagePlan(plotId);
            return NONE;
        }
        if (status === undefined) return keptOrOffline(); // the request never reached the server: no net
        return NONE;
    }
}

/**
 * The answer for one plot, asked again when `refreshKey` changes (the schedules the plot follows changed). `undefined` while the first
 * answer is on its way. Never throws.
 */
export function useStagePlan(plotId: string | null, refreshKey: string): StagePlanResult | undefined {
    const [result, setResult] = useState<{ key: string; value: StagePlanResult } | undefined>(undefined);
    const key = `${plotId ?? ''}|${refreshKey}`;
    useEffect(() => {
        if (!plotId) return undefined;
        let alive = true;
        void loadStagePlan(plotId).then(
            value => { if (alive) setResult({ key, value }); },
            () => { if (alive) setResult({ key, value: NONE }); },
        );
        return () => { alive = false; };
    }, [plotId, key]);
    return result?.key === key ? result.value : undefined;
}
