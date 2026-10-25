// spec: plr-d10-redesign-real-integration-2026-10-25 (I1 — X6)
//
// The pre-login database (`AgriLogDB_unidentified`) holds what is written before anybody
// signs in: the device's consent mark and an acceptance still waiting to be linked to an
// account. Once a farmer signs in, `getDatabase()` serves HIS database, which never held
// either — so every reader that used `getDatabase()` silently stopped seeing them. The
// visible cost was a signed-in farmer's offline voice capture being thrown away for want
// of a consent mark that sat, untouched, one database over.
//
// This opens that database on purpose, for the few readers that need it. It never creates
// it: a phone that has never shown the login screen has no pre-login facts to read.

import Dexie from 'dexie';
import { AgriLogDatabase, getDatabase } from './DexieDatabase';
import { getActiveDatabaseName } from './activeDatabaseName';
import { UNIDENTIFIED_DATABASE_NAME } from './userDatabaseName';

/**
 * Runs `run` against the pre-login database: the live handle when it is the active one,
 * otherwise a short-lived handle closed straight after. Returns `fallback` when that
 * database does not exist or anything fails — callers here are consent guards that must
 * fail closed, and storage helpers that must never throw.
 */
export async function withPreLoginDatabase<T>(
    run: (db: AgriLogDatabase) => Promise<T>,
    fallback: T,
): Promise<T> {
    try {
        if (getActiveDatabaseName() === UNIDENTIFIED_DATABASE_NAME) return await run(getDatabase());
        if (!(await Dexie.exists(UNIDENTIFIED_DATABASE_NAME))) return fallback;
        const db = new AgriLogDatabase(UNIDENTIFIED_DATABASE_NAME);
        try {
            return await run(db);
        } finally {
            db.close();
        }
    } catch {
        return fallback;
    }
}
