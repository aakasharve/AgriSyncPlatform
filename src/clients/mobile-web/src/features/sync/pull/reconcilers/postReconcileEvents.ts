/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Post-transaction side effects:
 *   - keep the runtime template catalog aligned with server data,
 *   - dispatch DOM events that finance hooks subscribe to.
 *
 * Runs OUTSIDE the Dexie transaction.
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';

type ReferencePayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
};

export function dispatchPostReconcileEvents(payload: SyncPullResponse): void {
    const referencePayload = payload as ReferencePayload;
    const scheduleTemplates = referencePayload.scheduleTemplates ?? [];

    setScheduleTemplatesFromReferenceData(scheduleTemplates);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', {
            detail: {
                costEntries: payload.costEntries ?? [],
                corrections: payload.financeCorrections ?? [],
                priceConfigs: payload.priceConfigs ?? [],
            },
        }));
        window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled'));
    }
}
