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
 */

const INVITE_STORE_KEY = 'shramsafal_farm_invite_v1';
const JOIN_ATTEMPTS_KEY = 'shramsafal_join_attempts_v1';

export const readInviteStoreRaw = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(INVITE_STORE_KEY);
    } catch {
        return null;
    }
};

export const writeInviteStoreRaw = (serialized: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(INVITE_STORE_KEY, serialized);
    } catch {
        // Storage full / denied — silent, the QR is still usable in-memory.
    }
};

export const readJoinAttemptsRaw = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(JOIN_ATTEMPTS_KEY);
    } catch {
        return null;
    }
};

export const writeJoinAttemptsRaw = (serialized: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(JOIN_ATTEMPTS_KEY, serialized);
    } catch {
        // best-effort only
    }
};
