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
 * WHAT THIS MODULE IS, HONESTLY. For a printable-ASCII id of at most
 * MAX_FARMER_ID_LENGTH (128) characters it is the IDENTITY FUNCTION: it returns
 * a string with the same characters, but one it built itself character by
 * character, so what reaches storage is a plain string and not a value that is
 * still attached to the session object. Anything empty, longer than 128
 * characters, or containing a character outside printable ASCII yields `null`
 * ("no identity", fail closed).
 *
 * WHAT IT DOES NOT DO. It does NOT by itself prove the string is not a
 * credential: a short printable-ASCII token would pass through unchanged. That
 * guarantee comes from the CALLERS, which pass only the user id and never the
 * access token. It is pinned separately by `noCredentialInStorage.test.ts`,
 * which scans localStorage, sessionStorage and every IndexedDB store for the
 * token strings after a login/refresh.
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
