/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHICH DATABASE IS OPEN RIGHT NOW
 * ================================
 *
 * One string and a listener set — deliberately free of any Dexie import, so
 * `DexieDatabase.ts` can depend on it without a cycle, and so switching farmer
 * is testable without an IndexedDB.
 *
 * The name is resolved LAZILY, from durable state, on first read. That is what
 * makes the routing safe: `getDatabase()` is called from 104 places in this app
 * — background workers, repositories, hooks — and none of them can be ordered
 * after provider start-up. Resolving from `userDatabaseName.ts` on the first
 * call of a boot means every one of them lands on the right farmer's database
 * whether the provider has run yet or not.
 *
 * `userDatabaseName.resolveActiveDatabaseName()` answers `AgriLogDB` until a
 * device has recorded an adoption, so on every install that has not switched
 * farmers this module is a no-op holding today's name.
 */

import { resolveActiveDatabaseName } from './userDatabaseName';

let activeDatabaseName: string | null = null;

const listeners = new Set<(databaseName: string) => void>();

/** The database the app should be reading and writing. */
export function getActiveDatabaseName(): string {
    if (activeDatabaseName === null) {
        activeDatabaseName = resolveActiveDatabaseName();
    }
    return activeDatabaseName;
}

/**
 * Switch farmer.
 *
 * Records a name and tells anyone holding a live subscription. It cannot
 * delete a row — it has no database handle to delete one with, which is the
 * point: leaving a farmer's database is not the same event as emptying it, and
 * conflating those two is the defect this whole change exists to remove.
 */
export function setActiveDatabaseName(databaseName: string): void {
    if (getActiveDatabaseName() === databaseName) {
        return;
    }

    activeDatabaseName = databaseName;

    for (const listener of listeners) {
        try {
            listener(databaseName);
        } catch (err) {
            console.error('[activeDatabaseName] listener failed', err);
        }
    }
}

/**
 * Subscribe to switches. Needed only by a subscription that outlives the
 * switch — a module-singleton `liveQuery`, which observes ONE database and
 * will not notice another. Everything else calls `getDatabase()` again and
 * lands on the new handle by itself.
 */
export function onActiveDatabaseChanged(listener: (databaseName: string) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Drop the resolved name so the next read re-derives it from durable state.
 * @internal — used by `resetDatabase()`.
 */
export function clearResolvedDatabaseName(): void {
    activeDatabaseName = null;
}
