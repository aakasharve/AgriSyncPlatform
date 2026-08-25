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
 *
 * THIS GUARANTEE IS CONTINGENT ON MOUNT LOCATION (read before relocating
 * `useOversightAcknowledgement`):
 * `currentUserId()` below is only correct because `DataSourceProvider.tsx`
 * (`useEffect` around line 113-165) gates `children` behind `isLoading` and
 * calls `activateDatabaseForUser(session.userId)` — which also sets
 * `DemoModeStore`'s active-user record this module reads — for every REAL
 * (non-demo) `session.userId` change, before any consumer of this hook can
 * be on screen. If a future component ever mounts
 * `useOversightAcknowledgement` OUTSIDE that gated tree (e.g. a route that
 * renders before `DataSourceProvider` resolves), `currentUserId()` can read
 * a stale or absent active-user id and this module will silently fall back
 * to `NO_ACTIVE_USER_BUCKET` — breaking per-farmer isolation without an
 * error anywhere.
 *
 * DEMO MODE IS A NARROWER, ALREADY-CONTAINED VERSION OF THE SAME GAP:
 * `DataSourceProvider.tsx` line 126 guards the `activateDatabaseForUser`
 * call with `!isDemoMode`, so entering demo mode does NOT update the
 * active-user record — `currentUserId()` keeps returning whatever the prior
 * real session (or `NO_ACTIVE_USER_BUCKET`) left behind. This is not a
 * real-farmer leak only because `storageNamespace.getKey()` still prefixes
 * the key with `demo_`, so it lands in the demo bucket regardless of which
 * user id it carries — demo data was never meant to be farmer-attributed.
 * It IS, however, the same class of gap: `currentUserId()` is trustworthy
 * only for as long as `DataSourceProvider`'s activation call keeps running
 * ahead of every read/write this module performs. Do not assume it self-
 * corrects in any code path that skips that provider.
 */

import { storageNamespace } from '../../infrastructure/storage/StorageNamespace';
import { DemoModeStore } from '../../infrastructure/storage/DemoModeStore';
import type { OversightAcknowledgementPort } from '../../features/oversight/OversightAcknowledgementPort';

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
