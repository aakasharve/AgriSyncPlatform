/**
 * FarmInviteStore — thin localStorage adapter for the farm-invite QR feature.
 *
 * Purpose-named storage adapter (Sub-plan 04 §DoD): the
 * features/onboarding/qr/farmInviteStore.ts module owns the invite issue/
 * rotate logic and per-farm-stable-code rules; raw read/write of the two
 * invite-related keys lives here so direct localStorage usage stays inside
 * infrastructure/storage/.
 *
 * Behavior is byte-for-byte equivalent to the original inline calls,
 * including the SSR `typeof window === 'undefined'` short-circuit and the
 * silent try/catch on storage-full / parse failures.
 *
 * P0.1: both keys were RAW. The invite key carries a farm-stable join code and
 * the attempts key is a rate limit — so the next farmer on the handset both saw
 * the previous farmer's farm invite and inherited their exhausted attempt
 * budget. Both are now scoped per farmer through `storageNamespace`; the
 * incumbent's existing entries are copied into their scope by
 * `adoptUnscopedBusinessKeys` and are never deleted.
 */

import { storageNamespace } from './StorageNamespace';

const INVITE_STORE_KEY = 'shramsafal_farm_invite_v1';
const JOIN_ATTEMPTS_KEY = 'shramsafal_join_attempts_v1';

export const readInviteStoreRaw = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(storageNamespace.getKey(INVITE_STORE_KEY));
    } catch {
        return null;
    }
};

export const writeInviteStoreRaw = (serialized: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageNamespace.getKey(INVITE_STORE_KEY), serialized);
    } catch {
        // Storage full / denied — silent, the QR is still usable in-memory.
    }
};

export const readJoinAttemptsRaw = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(storageNamespace.getKey(JOIN_ATTEMPTS_KEY));
    } catch {
        return null;
    }
};

export const writeJoinAttemptsRaw = (serialized: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageNamespace.getKey(JOIN_ATTEMPTS_KEY), serialized);
    } catch {
        // best-effort only
    }
};
