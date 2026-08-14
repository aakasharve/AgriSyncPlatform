/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WHOSE ATTACHMENT BYTES ARE THESE? (P0.1)
 * ========================================
 *
 * THE DEFECT
 * ----------
 * Every attachment a farmer captures — the photo of a patti, a receipt, a
 * damaged vine — is stored in ONE Cache Storage bucket named
 * `agrisync-local-files-v1`. Cache Storage is ORIGIN-scoped, so that bucket sat
 * outside per-farmer isolation entirely: `caches.open('agrisync-local-files-v1')`
 * answers the same object for every session on the handset, and a path that
 * leaked into any other farmer's session read back the bytes.
 *
 * WHY RENAMING IS NOT THE FIX
 * ---------------------------
 * A per-farmer cache NAME isolates future writes only. The old bucket still
 * exists, still holds every existing attachment, and is still openable by name
 * from anywhere — so a codebase that renames and then falls back to the old
 * bucket on a miss has isolated nothing, and one that renames WITHOUT a
 * fallback orphans the incumbent's own photos: their rows carry paths that miss
 * in the new bucket and the read throws.
 *
 * THE BOUNDARY
 * ------------
 * Access is derived from the ownership answer that already exists, rather than
 * from a name a caller passes in:
 *
 *   active database is `AgriLogDB`          -> the incumbent, who owns every
 *                                              byte already in the shared
 *                                              bucket: SAME bucket, nothing
 *                                              moves, nothing is orphaned.
 *   active database is `AgriLogDB_u_<id>`   -> that farmer's own bucket.
 *   active database is the unidentified one -> NO bucket. Fail closed.
 *
 * The active database name is the claim-verified routing answer from
 * `activateDatabaseForUser` (`appMeta.owner_user_id`, written-or-verified
 * inside the database itself), so the cache inherits the strongest ownership
 * evidence on the device rather than inventing a second, weaker one.
 *
 * There is deliberately NO cross-bucket fallback. A farmer on their own bucket
 * never reads another bucket, so the leak cannot be reintroduced by a read path
 * that "remembers" to look in the old place.
 *
 * NOTHING HERE DELETES A BUCKET. `caches.delete` appears nowhere: the shared
 * bucket is quarantined behind the ownership check, exactly as a previous
 * farmer's database is.
 */

import { getActiveDatabaseName } from '../storage/activeDatabaseName';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
} from '../storage/userDatabaseName';

/**
 * The bucket every install already has. It belongs to whoever adopted
 * `AgriLogDB` — the same farmer, by construction, since both were written by
 * the same pre-isolation build on the same handset.
 */
export const LEGACY_LOCAL_FILE_CACHE_NAME = 'agrisync-local-files-v1';

/**
 * The bucket the CURRENT session may open, or `null` when no farmer has been
 * established and therefore no farmer's media may be read or written.
 */
export function ownedLocalFileCacheName(): string | null {
    const databaseName = getActiveDatabaseName();

    if (databaseName === UNIDENTIFIED_DATABASE_NAME) {
        return null;
    }
    if (databaseName === LEGACY_DATABASE_NAME) {
        return LEGACY_LOCAL_FILE_CACHE_NAME;
    }
    return `${LEGACY_LOCAL_FILE_CACHE_NAME}__${databaseName}`;
}

/** Raised when a session with no established farmer reaches for media. */
export class NoOwnedFileCacheError extends Error {
    constructor(intent: string) {
        super(
            `Refusing to ${intent} local attachment files: no farmer is established `
            + 'on this session, and attachment bytes belong to a farmer.'
        );
        this.name = 'NoOwnedFileCacheError';
    }
}

/**
 * Open the current farmer's bucket.
 *
 * @param intent verb used in the error, so a refusal names what was refused.
 * @throws NoOwnedFileCacheError when identity is not established.
 */
export async function openOwnedLocalFileCache(intent: string): Promise<Cache> {
    const name = ownedLocalFileCacheName();
    if (name === null) {
        throw new NoOwnedFileCacheError(intent);
    }
    return caches.open(name);
}
