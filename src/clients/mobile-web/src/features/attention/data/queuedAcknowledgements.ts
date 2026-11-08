/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5 fix pass 1, F4) - the wrong-mix alerts whose "पाहिलं" is on this phone's queue and
 * on its way: waiting, being sent, or failed and still to be tried again. While one is, the card is not shown again - not after an app
 * restart before the push (nothing is left in memory), not when a pull lands before the push drains, and not when the phone's clock is
 * behind the server's. A request the server refused for good (or that gave up past the retry cap) is no longer on its way: its card
 * comes back, and the next tap queues it again (`acknowledgeMixAlert`). An applied one is the server's now: the board decides.
 *
 * Read only. A phone database that cannot be read gives none (the card is then shown, never hidden on a guess).
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { MAX_AUTO_RETRY_COUNT } from '../../../infrastructure/sync/retryCap';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export async function readQueuedAcknowledgements(): Promise<ReadonlySet<string>> {
    try {
        const rows = await getDatabase().mutationQueue.where('status').anyOf(['PENDING', 'SENDING', 'FAILED']).toArray();
        const ids = new Set<string>();
        for (const row of rows) {
            if (row.mutationType !== SyncMutationName.ComplianceAcknowledge) continue;
            if (row.status === 'FAILED' && row.retryCount >= MAX_AUTO_RETRY_COUNT) continue; // given up: not on its way
            const signalId = (row.payload as { signalId?: unknown } | null | undefined)?.signalId;
            if (typeof signalId === 'string') ids.add(signalId);
        }
        return ids;
    } catch {
        return new Set<string>();
    }
}
