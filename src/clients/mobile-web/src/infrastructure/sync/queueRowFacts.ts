/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M fix pass 1) — facts a queue row keeps ON THIS PHONE about
 * itself, never sent (each payload is its released type, unchanged). NOT indexed, so no Dexie version bump (the same rule
 * as `errorCode` / `nextRetryAfterMs` on `MutationQueueItem`); absent on older rows.
 */
import type { MutationQueueItem } from '../storage/DexieDatabase';

export interface QueueRowFacts {
    /**
     * Call C — on a record's FIRST money (`add_cost_entry`): the record line it was made from (`<logId>:<kind>:<lineId>`).
     * Read just before the row is sent, so money that goes after an edit carries the line's CURRENT amount, and a queued
     * edit of that record waits for it (`recordMoneyOrder.ts`).
     */
    moneySource?: string;
    /** Review 7 — on a queued edit (`revise_log_content`): it changes a priced line, so आढावा counts it as a gap until applied. */
    changesMoney?: boolean;
}

/** A queue row with its phone-only facts. */
export type QueueRowWithFacts = MutationQueueItem & QueueRowFacts;
