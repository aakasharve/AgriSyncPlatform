/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE ONE CALL THAT REPLACES THE WIPE
 * ===================================
 *
 * `DataSourceProvider` used to answer "a different farmer has signed in" by
 * clearing 21 Dexie tables, destroying `PENDING` and `FAILED` mutations that
 * had never left the handset along with the `db.logs` rows they belonged to.
 * It answers it by calling this instead, which deletes nothing at all: it
 * points the app at the database that farmer's rows live in and leaves every
 * other database exactly as it was.
 *
 * The three writes below are one decision and must stay in this order:
 *
 *   1. `resolveDatabaseNameForUser` — asks which database this farmer owns,
 *      settling (once, permanently) who adopted the pre-existing `AgriLogDB`.
 *      It reads the OUTGOING active user id to do that, so it must run FIRST.
 *   2. `DemoModeStore.setActiveUserId` — records the incoming farmer, so that
 *      after a reload `getDatabase()` re-derives the same name on its first
 *      call, before any provider code runs.
 *   3. `setActiveDatabaseName` — swings the handle and wakes live subscribers.
 *
 * Write (2) before (3) so the durable record and the in-memory name can never
 * disagree, even if the tab is killed between them.
 *
 * AND A FOURTH, WHICH IS THE ONE THAT FAILS CLOSED (P0.1)
 * -------------------------------------------------------
 *   4. `claimDatabaseOwnership` — write-or-verify `appMeta.owner_user_id`
 *      inside the database just routed to.
 *
 * Steps 1 to 3 all read localStorage, and localStorage can be cleared without
 * clearing IndexedDB. When that happens they agree with each other and are all
 * three wrong together, which is exactly how one farmer was handed another
 * farmer's database. Step 4 asks the database itself, and it is the only one of
 * the four that can contradict the other three.
 *
 * It cannot run before the routing — routing is synchronous and IndexedDB is
 * not — so it runs after and CORRECTS. On a conflict the caller is moved onto
 * their own database immediately and the mirror is rewritten from the claim.
 * Nothing is deleted: the database that was wrongly opened is left exactly as
 * it was, quarantined, because the handset may hold its owner's only copy.
 */

import { DemoModeStore } from './DemoModeStore';
import { getActiveDatabaseName, setActiveDatabaseName } from './activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    perUserDatabaseName,
    recordVerifiedLegacyDatabaseOwner,
    resolveDatabaseNameForUser,
} from './userDatabaseName';
import { getDatabase } from './DexieDatabase';
import { claimDatabaseOwnership, trackOwnershipClaim } from './databaseOwnership';

export interface UserDatabaseActivation {
    /** The database now serving `getDatabase()`. */
    databaseName: string;
    /** True when this call moved the app off another farmer's database. */
    switched: boolean;
}

/**
 * Make `userId`'s database the active one.
 *
 * Idempotent: called on every boot with the signed-in farmer, and a no-op
 * (`switched: false`) when that farmer is already active — which is what keeps
 * an ordinary logout/login from disturbing anything.
 */
export function activateDatabaseForUser(userId: string): UserDatabaseActivation {
    const databaseName = resolveDatabaseNameForUser(userId);
    const switched = getActiveDatabaseName() !== databaseName;

    DemoModeStore.setActiveUserId(userId);
    setActiveDatabaseName(databaseName);
    trackOwnershipClaim(enforceOwnership(databaseName, userId));

    return { databaseName, switched };
}

/**
 * Ask the database whose it is, and act on a disagreement.
 *
 * Not `async`, so `getDatabase()` is evaluated in the same synchronous turn as
 * the `setActiveDatabaseName` above it. An `async` function would resolve the
 * handle after the first `await`, by which time another activation could have
 * swung the name and the claim would be written into the wrong database — the
 * bug this function exists to catch.
 */
function enforceOwnership(databaseName: string, userId: string): Promise<void> {
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve();
    }

    return claimDatabaseOwnership(getDatabase(), userId).then(result => {
        if (result.outcome !== 'conflict' || result.owner === null) {
            return;
        }

        // The routing sent this farmer to a database another farmer has
        // claimed from inside. The claim is better evidence than anything in
        // localStorage, so it wins: repair the mirror and leave.
        console.error(
            '[activateUserDatabase] routed to a database another farmer owns; leaving it untouched',
            { databaseName, routedFor: userId, ownedBy: result.owner }
        );
        if (databaseName === LEGACY_DATABASE_NAME) {
            recordVerifiedLegacyDatabaseOwner(result.owner);
        }
        // Quarantine, never delete: the incumbent's rows stay exactly where
        // they are and nobody is routed to them.
        setActiveDatabaseName(perUserDatabaseName(userId));
    });
}
