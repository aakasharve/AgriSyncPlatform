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
 */

import { DemoModeStore } from './DemoModeStore';
import { getActiveDatabaseName, setActiveDatabaseName } from './activeDatabaseName';
import { resolveDatabaseNameForUser } from './userDatabaseName';

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

    return { databaseName, switched };
}
