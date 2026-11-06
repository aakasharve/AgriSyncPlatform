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
import { mergeFarmRates } from '../../../finance/farmRates/farmRatesStore';

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

    // spec: plr-d10 lane RATE-1 part A (pre-flight T2) — a pull is INCREMENTAL, so its `priceConfigs` are only the rows
    // changed since the last one. This key used to be REPLACED by them: after any pull that carried none, an app restart
    // read an empty list. Merged by id now; every row it held is kept.
    const heldPriceConfigs = await db.appMeta.get('shramsafal_finance_price_configs_v1');
    const priceConfigsById = new Map<string, unknown>(
        (Array.isArray(heldPriceConfigs?.value) ? (heldPriceConfigs.value as unknown[]) : [])
            .map((row, i) => [String((row as { id?: unknown } | null)?.id ?? `held-${i}`), row] as const),
    );
    for (const row of payload.priceConfigs ?? []) {
        priceConfigsById.set(String((row as { id?: unknown } | null)?.id ?? `new-${priceConfigsById.size}`), row);
    }
    await db.appMeta.put({
        key: 'shramsafal_finance_price_configs_v1',
        value: [...priceConfigsById.values()],
        updatedAt: receivedAtUtc,
    });

    // spec: plr-d10 lane RATE-1 part A (founder D-72) — each farm's OWN rate list, merged by id per farm (no Dexie bump).
    await mergeFarmRates(db, payload.farmRates, receivedAtUtc);
}
