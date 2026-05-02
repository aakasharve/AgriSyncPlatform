/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Reads the mutation queue for clientside-pending log writes so the
 * pull reconciler does not overwrite them with stale server state.
 * ARCH-S004 invariant.
 */

import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';

export async function readPendingLogIds(db: AgriLogDatabase): Promise<Set<string>> {
    const pendingLogIds = new Set<string>();
    try {
        const pending = await db.mutationQueue
            .where('status')
            .anyOf(['PENDING', 'SENDING', 'FAILED'])
            .toArray();
        for (const mutation of pending) {
            const payloadObj = mutation.payload as
                | { dailyLogId?: string; logId?: string; id?: string }
                | null
                | undefined;
            if (!payloadObj || typeof payloadObj !== 'object') continue;
            if (payloadObj.dailyLogId) pendingLogIds.add(payloadObj.dailyLogId);
            if (payloadObj.logId) pendingLogIds.add(payloadObj.logId);
        }
    } catch (error) {
        console.warn('SyncPullReconciler: failed to read mutationQueue for conflict detection', error);
    }
    return pendingLogIds;
}
