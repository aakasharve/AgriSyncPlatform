/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 * Day-ledger appMeta key helper. Public API: BackgroundSyncWorker
 * also imports this from the orchestrator's re-export.
 */

export function dayLedgerMetaKey(id: string): string {
    return `shramsafal_day_ledger_${id}`;
}
