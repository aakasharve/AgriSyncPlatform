/**
 * JoinResultStore - purpose-named session adapter for the QR join landing page.
 *
 * A farm-invite token is single-use: once the claim has succeeded the server
 * has consumed it, but the token stays in the page URL until the farmer taps
 * "open my farm". A refresh in that window used to forget the success and
 * restart at Step 1 with a token that can never work again. This keeps the
 * server's own answer (the claim response: farm name, role, membership id -
 * nothing secret) for the lifetime of the tab, keyed by the token, so the page
 * can show "you're in" again. sessionStorage, not localStorage: it ends with
 * the tab and never reaches another farmer on a shared handset.
 *
 * Every access is wrapped: a private window or blocked storage just means the
 * old behaviour (memory only), never an error.
 */

export interface StoredJoinResult {
    membershipId: string;
    farmId: string;
    farmName: string;
    role: string;
    wasAlreadyMember?: boolean;
}

const KEY_PREFIX = 'shramsafal_join_result_v1:';

export const readJoinResult = (token: string): StoredJoinResult | null => {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.sessionStorage.getItem(KEY_PREFIX + token);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredJoinResult> | null;
        if (!parsed || typeof parsed.farmId !== 'string' || typeof parsed.role !== 'string') return null;
        return parsed as StoredJoinResult;
    } catch {
        return null;
    }
};

export const writeJoinResult = (token: string, result: StoredJoinResult): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(KEY_PREFIX + token, JSON.stringify(result));
    } catch {
        // Storage denied / full - the in-memory record still serves this mount.
    }
};

export const clearJoinResult = (token: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem(KEY_PREFIX + token);
    } catch {
        // nothing to clear
    }
};
