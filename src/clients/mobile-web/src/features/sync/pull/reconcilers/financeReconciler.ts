/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reconciles finance cost entries + corrections + price configs:
 *   - normalize each row's mojibake,
 *   - persist to Dexie tables,
 *   - mirror normalized arrays into appMeta keys for cheap selectors.
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block.
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeDeep } from '../../../../shared/utils/textEncoding';

export async function reconcileFinance(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<void> {
    const parsedCostEntries = payload.costEntries ?? [];
    const normalizedCostEntries = parsedCostEntries.map(
        entry => normalizeMojibakeDeep(entry).value,
    );
    for (const ce of normalizedCostEntries) {
        await db.costEntries.put({
            id: ce.id,
            farmId: ce.farmId,
            payload: ce,
            updatedAt: receivedAtUtc,
        });
    }

    const parsedCorrections = payload.financeCorrections ?? [];
    const normalizedCorrections = parsedCorrections.map(
        correction => normalizeMojibakeDeep(correction).value,
    );
    for (const fc of normalizedCorrections) {
        await db.financeCorrections.put({
            id: fc.id,
            costEntryId: fc.costEntryId,
            payload: fc,
            updatedAt: receivedAtUtc,
        });
    }

    await db.appMeta.put({
        key: 'shramsafal_finance_cost_entries_v1',
        value: normalizedCostEntries,
        updatedAt: receivedAtUtc,
    });

    await db.appMeta.put({
        key: 'shramsafal_finance_corrections_v1',
        value: normalizedCorrections,
        updatedAt: receivedAtUtc,
    });

    await db.appMeta.put({
        key: 'shramsafal_finance_price_configs_v1',
        value: payload.priceConfigs ?? [],
        updatedAt: receivedAtUtc,
    });
}
