/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE MOMENT ONE FARMER'S SESSION ENDS ON THIS HANDSET (P0.1)
 * ===========================================================
 *
 * Isolation was written for a cold boot: which database does this device open
 * when it starts? The shared-handset leak does not happen at a cold boot. It
 * happens at a TRANSITION — farmer A hands the phone over, farmer B signs in —
 * and until this module existed nothing ran at that moment. `SessionStore`
 * carried the previous farmer's farm and `clearCurrentFarmId()` had zero
 * production callers; the Dexie handle stayed pointed at the previous farmer's
 * database until somebody else's activation moved it.
 *
 * Two things happen when a local session ends, and neither of them deletes a
 * farmer's records:
 *
 *   1. The farm pointer is cleared. It says WHICH FARM the handset is looking
 *      at, and `LogCommandService` stamps new records with it — so a farm
 *      pointer that outlives its session is a record filed under the wrong
 *      farm, not merely a stale screen.
 *   2. Routing leaves the farmer's database for the unidentified boundary. The
 *      database itself is untouched — quarantined, not emptied — because this
 *      handset may hold the only copy of that farmer's unsent work.
 *
 * WHY IT HANGS OFF `clearAuthSession` AND NOT OFF THE LOGOUT BUTTON
 * -----------------------------------------------------------------
 * `clearAuthSession()` is the one function every path to "this device no longer
 * has an authenticated session" goes through: the logout button, a boot refresh
 * that comes back empty, and the 401 interceptor when a refresh finally fails.
 * A farmer whose session died in the second or third way is exactly as
 * unidentified as one who pressed logout, and the founder ruling draws the line
 * at identity, not at intent.
 */

import { SessionStore } from './SessionStore';
import { setActiveDatabaseName } from './activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from './userDatabaseName';

export function endFarmerSessionLocally(): void {
    SessionStore.clearCurrentFarmId();
    setActiveDatabaseName(UNIDENTIFIED_DATABASE_NAME);
}
