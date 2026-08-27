/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE OWNERSHIP CLAIM LIVES INSIDE THE DATABASE IT DESCRIBES
 * ==========================================================
 *
 * THE DEFECT (P0.1)
 * -----------------
 * Which farmer owns `AgriLogDB` was recorded in exactly one place —
 * `localStorage.agrisync_legacy_db_owner_v1` — which is not the database. A
 * privacy-mode pass, a "clear cookies and site data", or an OS storage reclaim
 * drops localStorage and leaves every IndexedDB row untouched. Routing then
 * read "nobody owns this" and handed the incumbent's entire database to the
 * next farmer who signed in on the handset: their harvest, their procurement,
 * their finance settings, their voice vocabulary, their farm context — and the
 * third-party WORKER NAMES inside their labour rows, which are the personal
 * data of people party to neither account.
 *
 * The claim was not corrupted. It was DELETED, and the routing failed OPEN.
 *
 * THE FIX
 * -------
 * One `appMeta` row — key `owner_user_id` — written in an `rw` transaction the
 * first time an authenticated farmer opens the database. The claim and the rows
 * it describes become one object: no partial clearing of browser storage can
 * desynchronize them, because erasing the claim now means erasing the data.
 *
 * `appMeta` has existed since schema v1 (`dexie/versions/v1.ts:27`), so this
 * needs NO Dexie version bump — and therefore no one-way upgrade for APK users.
 *
 * TWO LAYERS, BECAUSE ROUTING CANNOT AWAIT
 * ----------------------------------------
 * `resolveDatabaseNameForUser` has to answer synchronously — `getDatabase()` is
 * called from background workers and repositories that cannot be ordered after
 * an IndexedDB read. So the claim is enforced twice:
 *
 *   1. RECOVERY, before routing. `recoverLegacyOwnershipClaim()` reads the
 *      claim out of `AgriLogDB` and repairs the synchronous mirror. Run at the
 *      point the app re-derives routing from durable state.
 *   2. ENFORCEMENT, after routing. Every activation writes-or-verifies the
 *      claim. If it finds the database is claimed by SOMEBODY ELSE, the routing
 *      was wrong and the caller is moved off it immediately.
 *
 * Layer 2 alone cannot close the leak (reads issued before it settles still hit
 * the wrong database); layer 1 alone cannot close it either (nothing guarantees
 * it ran). Together the wrong database is unreachable in the ordinary path and
 * survivable for at most one transaction in the pathological one.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * ------------------------------
 * Delete a database, or a row in one. A previous farmer's database is
 * QUARANTINED — routed to by nobody — never removed. `P10` is not yet true: the
 * handset may hold the only copy of that farmer's work.
 */

import Dexie from 'dexie';
import {
    LEGACY_DATABASE_NAME,
    getLegacyDatabaseOwner,
    recordVerifiedLegacyDatabaseOwner,
} from './userDatabaseName';

/**
 * The `appMeta` key carrying the claim. A literal, not namespaced and not
 * user-derived: the row's whole job is to answer "whose is this?" for a reader
 * who does not yet know the answer.
 */
export const DATABASE_OWNER_META_KEY = 'owner_user_id';

/** What a database says about who owns it. */
export type OwnershipStatus =
    /** The database does not exist on this device. Nothing to leak. */
    | 'absent'
    /** It exists and carries no claim — pre-P0.1 rows, or a fresh install. */
    | 'unclaimed'
    /** It exists and names an owner. */
    | 'claimed'
    /** It could not be read. Treat as "do not adopt", never as "unclaimed". */
    | 'unreadable';

export interface OwnershipProbe {
    status: OwnershipStatus;
    /** Set only when `status === 'claimed'`. */
    owner: string | null;
}

/** The result of writing-or-verifying a claim during activation. */
export type ClaimOutcome =
    /** The database had no owner; this farmer is now recorded as it. */
    | 'claimed'
    /** The database already names this farmer. */
    | 'confirmed'
    /** The database names SOMEONE ELSE. The routing was wrong. */
    | 'conflict'
    /** No IndexedDB on this platform, or the transaction failed. */
    | 'unavailable';

export interface ClaimResult {
    outcome: ClaimOutcome;
    /** The owner now on record inside the database, when one could be read. */
    owner: string | null;
}

interface OwnerMetaRow {
    key: string;
    value: unknown;
    updatedAt: string;
}

function ownerOf(row: OwnerMetaRow | undefined): string | null {
    return typeof row?.value === 'string' && row.value.length > 0 ? row.value : null;
}

function hasIndexedDb(): boolean {
    return typeof indexedDB !== 'undefined';
}

/**
 * Read the claim out of a database WITHOUT creating it.
 *
 * `Dexie.exists` is checked first on purpose: opening a Dexie handle for a name
 * that has never existed CREATES an empty database, and a probe that
 * manufactures the thing it is probing for would turn "this device is clean"
 * into "this device has an unclaimed AgriLogDB" on every boot.
 *
 * The handle is opened in Dexie's dynamic mode (no `version()` declared), so it
 * adopts whatever schema is already on disk and cannot trigger an upgrade. A
 * read must never migrate.
 */
export async function probeDatabaseOwner(databaseName: string): Promise<OwnershipProbe> {
    if (!hasIndexedDb()) {
        return { status: 'unreadable', owner: null };
    }

    let probe: Dexie | null = null;
    try {
        if (!(await Dexie.exists(databaseName))) {
            return { status: 'absent', owner: null };
        }
        probe = new Dexie(databaseName);
        await probe.open();
        if (!probe.tables.some(table => table.name === 'appMeta')) {
            return { status: 'unclaimed', owner: null };
        }
        const row = await probe.table('appMeta').get(DATABASE_OWNER_META_KEY) as OwnerMetaRow | undefined;
        const owner = ownerOf(row);
        return owner === null
            ? { status: 'unclaimed', owner: null }
            : { status: 'claimed', owner };
    } catch (err) {
        // Deliberately NOT 'unclaimed'. An unreadable database is one whose
        // owner is unknown, and "unknown" must never resolve to "yours".
        console.warn('[databaseOwnership] could not read the claim in', databaseName, err);
        return { status: 'unreadable', owner: null };
    } finally {
        probe?.close();
    }
}

/**
 * Write the claim if the database has none, or check it against the farmer who
 * is opening it.
 *
 * One `rw` transaction over `appMeta`, so read-then-write cannot interleave
 * with a second tab doing the same thing and produce two owners.
 *
 * Takes the open handle rather than a name: the claim must be written through
 * the SAME handle the app is about to read and write with, or a second
 * connection would race the first over an upgrade.
 */
export async function claimDatabaseOwnership(db: Dexie, userId: string): Promise<ClaimResult> {
    if (!hasIndexedDb()) {
        return { outcome: 'unavailable', owner: null };
    }

    try {
        const table = db.table('appMeta');
        return await db.transaction('rw', table, async (): Promise<ClaimResult> => {
            const existing = ownerOf(await table.get(DATABASE_OWNER_META_KEY) as OwnerMetaRow | undefined);
            if (existing === null) {
                await table.put({
                    key: DATABASE_OWNER_META_KEY,
                    value: userId,
                    updatedAt: new Date().toISOString(),
                });
                return { outcome: 'claimed', owner: userId };
            }
            return existing === userId
                ? { outcome: 'confirmed', owner: existing }
                : { outcome: 'conflict', owner: existing };
        });
    } catch (err) {
        console.warn('[databaseOwnership] could not record the claim in', db.name, err);
        return { outcome: 'unavailable', owner: null };
    }
}

/**
 * Repair the synchronous mirror from the claim inside `AgriLogDB`.
 *
 * This is the step that closes the reported leak. Once the claim is inside the
 * database, a farmer who clears browser storage has not deleted the answer —
 * only the copy of it — and this reads the original back before anybody is
 * routed anywhere.
 *
 * Non-destructive in both directions: it writes one localStorage key and never
 * touches a row, a table or a database.
 */
export async function recoverLegacyOwnershipClaim(): Promise<OwnershipProbe> {
    const probe = await probeDatabaseOwner(LEGACY_DATABASE_NAME);

    if (probe.status === 'claimed' && probe.owner !== null) {
        const mirrored = getLegacyDatabaseOwner();
        if (recordVerifiedLegacyDatabaseOwner(probe.owner)) {
            console.info(
                '[databaseOwnership] restored the AgriLogDB owner from the database itself',
                { mirrorWas: mirrored, ownerIs: probe.owner }
            );
        }
    }

    return probe;
}

// =============================================================================
// IN-FLIGHT CLAIMS
// =============================================================================

/**
 * Activation is synchronous — callers use its return value on the next line —
 * but the claim it triggers is not. Anything that needs the claim SETTLED
 * before it reads (a boot that re-derives routing, a migration that is about to
 * import into whichever database is open) awaits this.
 *
 * Rejections are absorbed here on purpose: a claim that cannot be written is a
 * degraded device, not a reason to fail a farmer's capture (`P9`). It is
 * reported by `claimDatabaseOwnership` as `unavailable` and logged there.
 */
let inFlight: Promise<unknown> = Promise.resolve();

export function trackOwnershipClaim(claim: Promise<unknown>): void {
    inFlight = Promise.allSettled([inFlight, claim]);
}

export async function settleOwnershipClaims(): Promise<void> {
    await inFlight;
}
