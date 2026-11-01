/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 1, call C) — a record's FIRST money never lands
 * at an old amount. Decided on this phone just before a batch goes, with no change to a released type:
 *
 *   1. First money (`add_cost_entry` made from a record line, `moneySource` on its queue row) is sent at the line's
 *      CURRENT amount (`recordMoneyNow.ts`) — so a retry, or a held row released after he changed the price, carries the
 *      new price (before it reaches the server it is this phone's own draft). Fix pass 2 (orchestrator call): a line he
 *      REMOVED still sends its money at the ORIGINAL saved amount — never dropped, so the record's first money is all on
 *      the server (rule B holds, the record stays movable) and the queued edit, which waits for it, then corrects it to
 *      ₹0 (or, for a seat that may not change money, leaves it flagged for review): the trail is the server's.
 *   2. A queued edit of a record (`revise_log_content`) waits — uncharged, still PENDING — while any of that record's first
 *      money is still on its way from this phone (waiting, sending, failed below the cap, or held). Then the server finds
 *      the money when the edit arrives, and the edit corrects it with its trail.
 *
 * A record's money rows are found by their `moneySource` (every line ever priced, removed ones too) and, for rows made
 * before that field existed, by the lines of this phone's copy of the record (`moneyRowsOfRecord`).
 */
import { getDatabase, type MutationQueueItem } from '../storage/DexieDatabase';
import type { QueueRowWithFacts } from './queueRowFacts';
import { MAX_AUTO_RETRY_COUNT } from './retryCap';
import { SyncMutationName } from './SyncMutationCatalog';
import { moneyRowsOfRecord } from './MutationDependency';
import { lineAmountNow } from '../../features/finance/recordMoneyNow';

/** Still on its way from this phone: it will reach the server without a tap. */
const onItsWay = (row: QueueRowWithFacts): boolean =>
    row.status === 'PENDING' || row.status === 'SENDING'
    || (row.status === 'FAILED' && row.retryCount < MAX_AUTO_RETRY_COUNT);

/**
 * Prepare a batch: first money takes its line's current amount (a removed line's keeps its saved amount); a queued edit
 * whose record's first money is still on its way is held back this cycle. Returns the rows to send, in their order.
 */
export async function prepareRecordMoney(rows: readonly MutationQueueItem[]): Promise<MutationQueueItem[]> {
    const db = getDatabase();
    const toSend: MutationQueueItem[] = [];

    for (const row of rows as readonly QueueRowWithFacts[]) {
        if (row.mutationType === SyncMutationName.AddCostEntry && row.moneySource && row.id !== undefined) {
            const payload = (row.payload ?? {}) as { costEntryId?: string; amount?: number };
            const now = await lineAmountNow(row.moneySource);
            if (now.state === 'priced' && now.amount !== payload.amount) {
                const current = { ...payload, amount: now.amount };
                await db.mutationQueue.update(row.id, { payload: current });
                toSend.push({ ...row, payload: current });
                continue;
            }
        }

        if (row.mutationType === SyncMutationName.ReviseLogContent) {
            const dailyLogId = String((row.payload as { dailyLogId?: unknown } | null)?.dailyLogId ?? '');
            if (dailyLogId && await firstMoneyOnItsWay(dailyLogId)) {
                // Uncharged and untouched: it is offered again next cycle, after the money.
                continue;
            }
        }

        toSend.push(row);
    }

    return toSend;
}

/** Is any of this record's first money still on its way from this phone? */
async function firstMoneyOnItsWay(dailyLogId: string): Promise<boolean> {
    const db = getDatabase();
    const moneyRows: QueueRowWithFacts[] = await db.mutationQueue.where('mutationType').equals(SyncMutationName.AddCostEntry).toArray();
    const legacyKeys = new Set((await moneyRowsOfRecord(dailyLogId)).map(r => r.clientRequestId));
    return moneyRows.some(row =>
        onItsWay(row) && (row.moneySource?.startsWith(`${dailyLogId}:`) || legacyKeys.has(row.clientRequestId)));
}
