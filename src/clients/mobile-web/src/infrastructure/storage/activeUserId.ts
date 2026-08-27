/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHICH FARMER THIS HANDSET IS SERVING
 * ====================================
 *
 * One localStorage key, `agrisync_active_user_id_v1`, read and written through
 * two functions. It existed before this module — `DemoModeStore` owned it, and
 * `DemoModeStore` still exposes it under its original names — but three
 * modules now need the same answer (`StorageNamespace` for key scoping,
 * `userDatabaseName` for routing, `activateUserDatabase` for adoption), and
 * routing them all through `DemoModeStore` would make the demo-mode adapter a
 * dependency of the isolation boundary and close an import cycle
 * (`DemoModeStore` -> `StorageNamespace` -> `DemoModeStore`).
 *
 * WHAT THIS VALUE IS, AND WHAT IT IS NOT
 * --------------------------------------
 * It IS the id of the last farmer this device activated, and it survives
 * logout deliberately: it is how the handset remembers whose un-namespaced
 * localStorage rows these are, and who adopted `AgriLogDB`.
 *
 * It is NOT proof that anybody is signed in. It must therefore never, on its
 * own, open a farmer's business database — "the previous active user" is a
 * forbidden routing fallback (founder ruling, P0.1). `resolveActiveDatabaseName`
 * no longer consults it for that reason.
 *
 * Both functions tolerate a missing `localStorage` (vitest's `node`
 * environment, and a hostile privacy mode) by answering "nobody", never by
 * throwing: the callers are on the boot path.
 */

const ACTIVE_USER_ID_KEY = 'agrisync_active_user_id_v1';

/** The last farmer activated on this device, or `null` if there has been none. */
export function readActiveUserId(): string | null {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    return localStorage.getItem(ACTIVE_USER_ID_KEY);
}

/** Record the farmer being activated. Written by `activateDatabaseForUser`. */
export function writeActiveUserId(userId: string): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.setItem(ACTIVE_USER_ID_KEY, userId);
}
