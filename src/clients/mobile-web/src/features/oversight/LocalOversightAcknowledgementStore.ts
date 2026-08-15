/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Owner Oversight Loop — local (localStorage) adapter for
 * `OversightAcknowledgementPort` (Task 2).
 *
 * PER-FARMER ISOLATION (binding — do not simplify this key):
 * Per-farmer storage isolation is a live P0 in another lane
 * (`userDatabaseName.ts` / `activateUserDatabase.ts` rebuilt Dexie's whole
 * storage model around exactly this: one farmer's data must never be
 * reachable from a shared handset signed in as another farmer). This
 * adapter is localStorage, not Dexie, so it has to reproduce that same
 * guarantee itself:
 *
 *  - The key is scoped by BOTH the active user id (`DemoModeStore`, the
 *    same "who is this handset signed in as" record `activateUserDatabase`
 *    already trusts for Dexie database routing) AND `farmId`, per the
 *    task brief's "(userId, farmId)" requirement.
 *  - The composed key is then passed through `storageNamespace.getKey()`,
 *    the same demo/real namespacing every other localStorage adapter in
 *    `infrastructure/storage/` uses (see `HarvestLegacyStore.ts`,
 *    `ProcurementLegacyStore.ts`), so demo-mode data can never bleed into a
 *    real farmer's checkpoint or vice versa.
 *
 * A bare, un-namespaced `oversight_ack_<farmId>` key would let one farmer's
 * "I've seen this" checkpoint apply to the next farmer who signs in on the
 * same phone — reopening the exact leak the other lane's P0 exists to close.
 */

import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { DemoModeStore } from '../../infrastructure/storage/DemoModeStore';
import type { OversightAcknowledgementPort } from './OversightAcknowledgementPort';

const KEY_PREFIX = 'oversight_ack_checkpoint_v1';

/**
 * Bucket used when no active user id has been recorded yet (e.g. before the
 * first `activateDatabaseForUser` call on a fresh install). Distinct from
 * any real user id by construction (real ids never contain a space), so it
 * can never collide with a genuine farmer's bucket.
 */
const NO_ACTIVE_USER_BUCKET = 'no active user';

function currentUserId(): string {
    return DemoModeStore.getActiveUserId() ?? NO_ACTIVE_USER_BUCKET;
}

function checkpointKey(farmId: string): string {
    return storageNamespace.getKey(`${KEY_PREFIX}_${currentUserId()}_${farmId}`);
}

/**
 * localStorage-backed `OversightAcknowledgementPort`. `acknowledge` relies on
 * `localStorage.setItem` throwing synchronously on failure (quota exceeded,
 * privacy mode, etc.) — inside this `async` method that throw becomes a
 * rejected promise, which is exactly the "throws on failure" contract the
 * port documents. Nothing here catches it and turns it into a success.
 */
export const LocalOversightAcknowledgementStore: OversightAcknowledgementPort = {
    async read(farmId: string): Promise<string | null> {
        return localStorage.getItem(checkpointKey(farmId));
    },

    async acknowledge(farmId: string, atISO: string): Promise<void> {
        localStorage.setItem(checkpointKey(farmId), atISO);
    },
};
