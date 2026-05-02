/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Mirrors the structural payload (farms / plots / crop cycles) into
 * their cache tables with mojibake normalization applied.
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block.
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeDeep } from '../../../../shared/utils/textEncoding';

export async function reconcileFarmsPlotsCycles(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<void> {
    const parsedFarms = payload.farms ?? [];
    const normalizedFarms = parsedFarms.map(farm => normalizeMojibakeDeep(farm).value);
    for (const f of normalizedFarms) {
        await db.farms.put({
            id: f.id,
            payload: f,
            updatedAt: receivedAtUtc,
        });
    }

    const parsedLocalPlots = payload.plots ?? [];
    const normalizedLocalPlots = parsedLocalPlots.map(plot => normalizeMojibakeDeep(plot).value);
    for (const p of normalizedLocalPlots) {
        await db.plots.put({
            id: p.id,
            farmId: p.farmId,
            payload: p,
            updatedAt: receivedAtUtc,
        });
    }

    const parsedCycles = payload.cropCycles ?? [];
    const normalizedCycles = parsedCycles.map(cycle => normalizeMojibakeDeep(cycle).value);
    for (const cy of normalizedCycles) {
        await db.cropCycles.put({
            id: cy.id,
            farmId: cy.farmId,
            plotId: cy.plotId,
            payload: cy,
            updatedAt: receivedAtUtc,
        });
    }
}
