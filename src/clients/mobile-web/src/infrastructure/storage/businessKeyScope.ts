/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE FARMER'S localStorage, NOT THE HANDSET'S
 * ============================================
 *
 * THE DEFECT (P0.1, A2.2)
 * -----------------------
 * `StorageNamespace.getKey()` discriminated by DEMO MODE and nothing else, so
 * in the ordinary 'user' namespace every farmer on a handset read and wrote the
 * SAME keys: harvest configs and sessions, other income, procurement expenses,
 * finance settings, the voice vocabulary, farm-invite join attempts and the
 * current-farm pointer. Logout cleared the auth session and left all of it in
 * place, so the next farmer to sign in inherited the previous farmer's money
 * and harvest state as if it were their own.
 *
 * THE FIX, AND THE ONE THING IT MUST NOT DO
 * -----------------------------------------
 * Business keys are prefixed with the farmer they belong to. The farmer is read
 * LIVE from `readActiveUserId()` on every call — never mirrored into a
 * `setUser()` field, because a mirror re-introduces the boot-order race that
 * `userDatabaseName.ts` was written to avoid: any reader that runs before the
 * setter would silently use the wrong prefix.
 *
 * The keys that already exist on a device were written before anyone was
 * prefixing anything, and harvest, procurement and finance have **no server
 * home** — that device is the only copy. So the incumbent's un-namespaced keys
 * are ADOPTED into the incumbent's own prefix on the first activation after
 * this change (`adoptUnscopedBusinessKeys`), and the originals are LEFT WHERE
 * THEY ARE. Copying costs a few kilobytes once; deleting would be data loss
 * wearing containment's clothes.
 *
 * WHAT IS DELIBERATELY NOT SCOPED
 * -------------------------------
 * - `agrisync_device_id_v1` (`DeviceIdStore`) — BOTH server dedupe layers key
 *   on the device id. Re-minting it per farmer would strand every unsent
 *   mutation already queued under the old one. It is device state, not farmer
 *   state, and it stays exactly as it is.
 * - `agrisync_active_user_id_v1`, `agrisync_legacy_db_owner_v1` — the questions
 *   "who is active" and "who owns AgriLogDB" cannot be asked from inside a
 *   per-farmer prefix; they are what CHOOSES the prefix.
 * - auth/session/remember-device keys — cleared by logout already, and owned by
 *   the auth layer.
 * - `demo_*` — demo mode is generated data in its own namespace, not a
 *   farmer's record.
 */

import { readActiveUserId } from './activeUserId';

/**
 * The prefix used when no farmer has been established on this device. It is a
 * real, reachable namespace (nothing throws) that simply belongs to nobody, so
 * a pre-authentication read cannot return a farmer's rows and a
 * pre-authentication write cannot land in a farmer's.
 */
export const UNIDENTIFIED_KEY_SCOPE = 'unidentified';

const SCOPE_PREFIX = 'u_';
const SCOPE_SEPARATOR = '__';

/**
 * Device-level marker: the incumbent's un-namespaced keys have been adopted.
 * NOT scoped itself — the adoption is a one-time device event, and a scoped
 * flag would re-run the adoption once per farmer and copy the incumbent's rows
 * into everybody's prefix.
 */
const ADOPTION_FLAG_KEY = 'agrisync_localstorage_scoped_v1';

/**
 * Business keys whose READ PATH becomes farmer-scoped by this change. Exact
 * names only; the two per-plot families are matched by prefix below.
 *
 * This list is the contract between `getKey()` and the adoption: a key that is
 * scoped for reads but missing here would leave the incumbent's data
 * unreachable, and a key here that is not scoped for reads would create a
 * copy nobody ever opens.
 */
const SCOPED_BUSINESS_KEYS: readonly string[] = [
    // Logs the pre-Dexie build wrote, still read by the legacy repository.
    'agrilog_logs_v1',
    // Imported into Dexie by `LegacyLocalStorageMigrator`.
    'crops',
    'farmer_profile',
    // Procurement / harvest / finance — no server home yet.
    'dfes_procurement_expenses',
    'harvest_other_income',
    'money_events',
    'finance_settings',
    // Voice vocabulary the farmer taught the app.
    'agrilog_vocab_db_v2',
    // Farm invites and the join-attempt rate limit.
    'shramsafal_farm_invite_v1',
    'shramsafal_join_attempts_v1',
    // Which farm this farmer is looking at.
    'shramsafal_current_farm_id',
];

/** Per-plot and per-plot-per-crop families: `harvest_config_<plotId>` etc. */
const SCOPED_BUSINESS_KEY_PREFIXES: readonly string[] = [
    'harvest_config_',
    'harvest_sessions_',
];

/** True for a key this module is responsible for scoping. */
function isBusinessKey(key: string): boolean {
    return SCOPED_BUSINESS_KEYS.includes(key)
        || SCOPED_BUSINESS_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * The prefix component for a farmer. `encodeURIComponent` is injective, so two
 * farmers can never be folded onto one prefix — the same property
 * `perUserDatabaseName` relies on.
 */
export function keyScopeFor(userId: string | null): string {
    return userId === null || userId.length === 0
        ? UNIDENTIFIED_KEY_SCOPE
        : encodeURIComponent(userId);
}

/** `harvest_other_income` -> `u_<farmer>__harvest_other_income`. */
export function scopedKeyFor(baseKey: string, userId: string | null): string {
    return `${SCOPE_PREFIX}${keyScopeFor(userId)}${SCOPE_SEPARATOR}${baseKey}`;
}

/** The scoped key for whoever this handset is serving right now. */
export function activeScopedKey(baseKey: string): string {
    return scopedKeyFor(baseKey, readActiveUserId());
}

/** Every un-scoped business key physically present, snapshotted before writing. */
function unscopedBusinessKeysPresent(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && isBusinessKey(key)) {
            keys.push(key);
        }
    }
    return keys;
}

/**
 * Give the incumbent's un-namespaced business keys to the incumbent.
 *
 * Runs once per device, from `activateDatabaseForUser`, BEFORE the incoming
 * farmer is recorded — so `incumbentUserId` is the farmer those keys actually
 * belong to and not the one arriving.
 *
 * COPIES. Never moves, never deletes, never overwrites an existing scoped
 * value. If the copy fails part-way (quota), the flag is NOT set and the next
 * boot tries again; a half-adoption that marked itself complete is exactly the
 * failure mode `LegacyLocalStorageMigrator` was corrected for in this same
 * change.
 *
 * @returns the base keys copied, for logging and for tests.
 */
export function adoptUnscopedBusinessKeys(incumbentUserId: string | null): string[] {
    if (typeof localStorage === 'undefined') {
        return [];
    }
    if (localStorage.getItem(ADOPTION_FLAG_KEY) === '1') {
        return [];
    }

    const adopted: string[] = [];
    for (const key of unscopedBusinessKeysPresent()) {
        const value = localStorage.getItem(key);
        if (value === null) {
            continue;
        }
        const target = scopedKeyFor(key, incumbentUserId);
        if (target === key || localStorage.getItem(target) !== null) {
            continue;
        }
        try {
            localStorage.setItem(target, value);
        } catch (err) {
            // Out of quota mid-adoption. Leave the flag unset so this is
            // retried, and leave every original key in place.
            console.warn('[businessKeyScope] could not adopt', key, err);
            return adopted;
        }
        adopted.push(key);
    }

    localStorage.setItem(ADOPTION_FLAG_KEY, '1');
    return adopted;
}

/**
 * Test/diagnostic helper: forget that the adoption ran. Production code must
 * not call this — the flag is what stops the incumbent's keys being copied
 * into a second farmer's prefix.
 */
export function __resetBusinessKeyAdoptionForTesting(): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    localStorage.removeItem(ADOPTION_FLAG_KEY);
}
