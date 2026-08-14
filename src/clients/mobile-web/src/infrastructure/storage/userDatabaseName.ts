/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHICH DATABASE BELONGS TO WHICH FARMER
 * ======================================
 *
 * THE DEFECT THIS EXISTS TO REMOVE
 * --------------------------------
 * `DataSourceProvider` used to clear 21 Dexie tables — `db.logs`,
 * `db.mutationQueue` and the rest — the moment `session.userId` differed from
 * the id the handset had on record. A farmer who captured work offline lost it
 * outright because somebody else signed in on the same phone. Their records
 * were `PENDING`: never sent, and after the wipe, never sendable.
 *
 * That wipe was not gratuitous. There was, and still is, no owning user on a
 * `MutationQueueItem` (`DexieDatabase.ts:111-123`), and no index in any schema
 * version through v22 carries a user key, so there was nothing to filter a read
 * by. Deleting everything was the only isolation the app had between two people
 * on one handset. Removing it without a replacement would have leaked one
 * farmer's records to another — worse than the bug.
 *
 * THE REPLACEMENT
 * ---------------
 * One IndexedDB database per farmer. Isolation stops being a rule every future
 * read path has to remember and becomes a property of the storage engine: user
 * B's queries cannot reach user A's rows because they are not in the database B
 * has open. Nothing is deleted on a switch. A's records simply stay in A's
 * database, still `PENDING`, still sendable the moment A signs back in.
 *
 * The rejected alternative — an `ownerUserId` column plus park-instead-of-clear
 * — needs every read path in the app to be user-scoped, and ONE missed path is
 * a cross-user leak: a worse failure than the one being fixed, and invisible in
 * testing.
 *
 * ADOPTING WHAT IS ALREADY ON THE HANDSET (the upgrade path)
 * ----------------------------------------------------------
 * Existing installs hold real work in a database literally named `AgriLogDB`.
 * It is not copied, moved, exported or re-keyed. It is ADOPTED: the farmer it
 * already belongs to keeps using it under its existing name, and only OTHER
 * farmers get a new database. Zero rows travel, so there is no upgrade step
 * that can half-finish, and a "fix" for data loss cannot itself lose data.
 *
 * Who it already belongs to is not guessed. `agrisync_active_user_id_v1` is the
 * id the handset was already keeping — the very value the old wipe compared
 * against — and it is a literal, non-namespaced key that survives logout. That
 * is the owner. The answer is recorded ONCE, on the first routing decision, in
 * `agrisync_legacy_db_owner_v1`, so it can never drift afterwards.
 *
 * If no one has ever authenticated on this install, the data in `AgriLogDB`
 * belongs to nobody on record, and the farmer signing in adopts it. That is the
 * conservative choice in both directions: it strands nothing, and the previous
 * behaviour for that same case was to DELETE the data.
 *
 * INERT UNTIL SWITCHED ON, DELIBERATELY
 * -------------------------------------
 * While `agrisync_active_user_id_v1` has no recorded owner, every function here
 * answers `AgriLogDB` — byte-for-byte today's behaviour. The owner is written
 * only by `activateUserDatabase.ts`, which only `DataSourceProvider` calls. So
 * this module cannot change where a single row lands until the provider opts
 * in, and a half-applied change cannot leave the app writing to a database no
 * one reads.
 *
 * WHY THE localStorage RECORD IS NO LONGER THE ANSWER (P0.1)
 * ---------------------------------------------------------
 * It was the only record, and it lives OUTSIDE the thing it describes. A
 * privacy-mode pass, a "clear cookies and site data", or an OS storage reclaim
 * removes it while leaving every IndexedDB row in place — and the code below
 * then read "nobody owns AgriLogDB" and handed the incumbent's whole database,
 * third-party worker names included, to the next person who signed in. The
 * routing did not get the answer wrong; it LOST the answer and failed OPEN.
 *
 * The claim now lives in `appMeta.owner_user_id`, INSIDE the database it
 * describes (`databaseOwnership.ts`). The record below is retained as a
 * synchronous MIRROR of that claim, because routing must answer before an
 * IndexedDB read can complete — but it is no longer the source of truth. When
 * the two disagree the in-database claim wins and rewrites the mirror
 * (`recordVerifiedLegacyDatabaseOwner`), because a claim kept inside the
 * database cannot be separated from the rows it describes: erasing it means
 * erasing them.
 */

import { DemoModeStore } from './DemoModeStore';

/**
 * The database every install has today, and the only one that exists before
 * this module is switched on. `DexieDatabase.ts` still defaults to it.
 */
export const LEGACY_DATABASE_NAME = 'AgriLogDB';

/**
 * Prefix for a database created FOR a farmer rather than adopted by one.
 * Distinct from `LEGACY_DATABASE_NAME` by construction, so no user id can
 * produce a name that collides with the adopted database.
 */
const PER_USER_DATABASE_PREFIX = 'AgriLogDB_u_';

/**
 * Records which farmer `AgriLogDB` was adopted by. Written exactly once, on
 * the first routing decision this device ever makes; never rewritten. NOT
 * namespaced — demo mode must not be able to answer this question differently
 * from real mode, or two namespaces would disagree about who owns the rows.
 */
const LEGACY_DB_OWNER_KEY = 'agrisync_legacy_db_owner_v1';

/**
 * True when `localStorage` is reachable. Vitest's default `node` environment
 * has none, and neither does a hostile privacy mode. In that case there is no
 * durable place to record an adoption, so routing MUST stay off: an
 * un-recordable claim that changed on the next boot would point a farmer at a
 * database that is not theirs.
 */
function canRecordOwnership(): boolean {
    return typeof localStorage !== 'undefined';
}

/** The farmer `AgriLogDB` was adopted by, or `null` if never decided. */
export function getLegacyDatabaseOwner(): string | null {
    if (!canRecordOwnership()) {
        return null;
    }
    return localStorage.getItem(LEGACY_DB_OWNER_KEY);
}

/**
 * Re-record an adoption that was read back OUT OF `AgriLogDB` itself.
 *
 * The only caller is `databaseOwnership.ts`, and the only value it may pass is
 * one it read from `appMeta.owner_user_id` inside the database in question.
 * That is strictly better evidence than this mirror: the claim and the rows it
 * describes are the same object, so it cannot be half-deleted. It therefore
 * OVERWRITES — unlike `resolveDatabaseNameForUser`'s write-once adoption, which
 * is a guess made from whatever the handset happened to be carrying.
 *
 * Returns true when the mirror actually changed, so a caller can log a
 * correction rather than a no-op.
 */
export function recordVerifiedLegacyDatabaseOwner(owner: string): boolean {
    if (!canRecordOwnership()) {
        return false;
    }
    if (localStorage.getItem(LEGACY_DB_OWNER_KEY) === owner) {
        return false;
    }
    localStorage.setItem(LEGACY_DB_OWNER_KEY, owner);
    return true;
}

/**
 * The database created FOR a farmer. Never `AgriLogDB`, by construction of the
 * prefix, so this is always a safe place to send somebody whose ownership of
 * the legacy database has not been established.
 */
export function perUserDatabaseName(userId: string): string {
    // `encodeURIComponent` is injective, so two distinct farmers can never be
    // folded onto one database name — the failure that would turn this fix into
    // the leak it was written to prevent.
    return `${PER_USER_DATABASE_PREFIX}${encodeURIComponent(userId)}`;
}

/**
 * The database name for a farmer, deciding the adoption on first use.
 *
 * Has a side effect on purpose: the adoption must be settled at the first
 * moment anyone asks, using the id the handset was already carrying, and then
 * frozen. Deciding it lazily at each call would let a later user-switch
 * re-answer it and hand one farmer's database to another.
 */
export function resolveDatabaseNameForUser(userId: string): string {
    if (!canRecordOwnership()) {
        return LEGACY_DATABASE_NAME;
    }

    let owner = getLegacyDatabaseOwner();
    if (owner === null) {
        // First routing decision on this device. Whoever the handset already
        // regarded as the active user owns everything in `AgriLogDB`; if it has
        // never had one, the rows belong to nobody on record and the farmer
        // signing in now adopts them rather than losing them.
        owner = DemoModeStore.getActiveUserId() ?? userId;
        localStorage.setItem(LEGACY_DB_OWNER_KEY, owner);
    }

    return owner === userId
        ? LEGACY_DATABASE_NAME
        : perUserDatabaseName(userId);
}

/**
 * The database the handset should already be open on, from durable state
 * alone. Read by `getDatabase()` on its first call of a boot, so every reader
 * — background workers included — lands on the right database with no
 * dependency on provider start-up order.
 *
 * Answers `AgriLogDB` whenever routing has not been switched on, which is what
 * makes this change inert until `DataSourceProvider` opts in.
 *
 * KNOWN RESIDUAL FAIL-OPEN, MEASURED AND NOT YET CLOSED
 * -----------------------------------------------------
 * The second branch below answers `AgriLogDB` when the database HAS a recorded
 * owner but nobody is signed in. An anonymous boot therefore still lands on the
 * owner's database. Closing it means `getDatabase()` refusing to answer, and
 * the measured blast radius of that is 122 production call sites in 55 files —
 * 96 of them unguarded, including 17 in `DexieLogsRepository` and 14 in
 * `MutationQueue`. A synchronous throw there stops a farmer recording today's
 * work, which `P9` forbids. It needs a place to route an unidentified session
 * to, which is a separate decision. Recorded here so it is not mistaken for
 * closed.
 */
export function resolveActiveDatabaseName(): string {
    const owner = getLegacyDatabaseOwner();
    if (owner === null) {
        return LEGACY_DATABASE_NAME;
    }

    const activeUserId = DemoModeStore.getActiveUserId();
    if (activeUserId === null) {
        return LEGACY_DATABASE_NAME;
    }

    return owner === activeUserId
        ? LEGACY_DATABASE_NAME
        : perUserDatabaseName(activeUserId);
}
