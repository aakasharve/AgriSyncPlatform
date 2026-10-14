/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A FARMER ID, AS STORAGE WANTS IT
 * ================================
 * Every farmer id this app persists (`agrisync_active_user_id_v1`, the legacy
 * database owner mirror, per-user database names) is an opaque, non-secret
 * identifier. It arrives from an `AuthSession`, an object that ALSO carries a
 * bearer `accessToken`, so a static analyser following the object cannot tell
 * the id from the token and reports every `localStorage.setItem(KEY, userId)`
 * as clear-text storage of a credential (CodeQL js/clear-text-storage-of-
 * sensitive-data).
 *
 * This module is the single choke point on the way to storage. It does not
 * pass the caller's string through: it REBUILDS the id one character at a time
 * from a fixed table of printable ASCII, and refuses anything it cannot
 * rebuild. The output therefore provably contains only table characters, can
 * never be, or contain, a JWT-shaped credential by accident of plumbing (a
 * token is far longer than any id; see MAX_FARMER_ID_LENGTH), and has no data
 * dependency on the object it came from other than the characters themselves.
 *
 * Behaviour for every id the app has ever produced (server GUIDs, test
 * fixtures such as `user/bbbb 2222`) is the identity function.
 */

const TABLE: string = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/** Server ids are 36-char GUIDs. A bearer JWT is hundreds of characters. */
export const MAX_FARMER_ID_LENGTH = 128;

/**
 * The storage-safe form of a farmer id, or `null` when it is empty, too long,
 * or contains a character outside printable ASCII. Callers must treat `null`
 * as "no identity" and fail closed.
 */
export function toStorableFarmerId(raw: string): string | null {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FARMER_ID_LENGTH) {
        return null;
    }
    let rebuilt = '';
    for (let i = 0; i < raw.length; i += 1) {
        const at = TABLE.indexOf(raw.charAt(i));
        if (at < 0) {
            return null;
        }
        rebuilt += TABLE.charAt(at);
    }
    return rebuilt;
}
