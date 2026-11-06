/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-46 §3) — what the reviewer SAW when he tapped मंजूर, kept on this phone
 * only so that, if the server answers "this record changed", the sheet can say what changed. A disposable cache
 * (doctrine P10: never business truth, never sent anywhere): when it is missing the change is shown without the
 * old values. Every access is guarded — private mode or full storage only loses the "before" half.
 *
 * Lane L4b fix round 1 (review L-4): an entry is HIS, for ONE farm — keyed by user and farm — and it lives only as
 * long as it is needed. It goes with the labour caches (another user signs in, the session ends, access to the farm
 * ends) and once the record is decided (the approval list no longer carries it and nothing of his is parked for it),
 * so no money amount he saw outlives the question it answers.
 */
const PREFIX = 'agrisync.approval.seen.';

const keyOf = (userId: string, farmId: string, logId: string): string =>
    `${PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(farmId)}.${encodeURIComponent(logId)}`;

function storage(): Storage | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

/** Removes every entry whose key does NOT pass `keep`. */
function removeWhere(keep: (key: string) => boolean): void {
    const s = storage();
    if (!s) return;
    try {
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k !== null && k.startsWith(PREFIX) && !keep(k)) doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
    } catch {
        // The cache is disposable.
    }
}

export const ApprovalSeenStore = {
    write(userId: string, farmId: string, logId: string, value: unknown): void {
        try {
            storage()?.setItem(keyOf(userId, farmId, logId), JSON.stringify(value));
        } catch {
            // Nothing is lost that the server does not hold.
        }
    },
    read<T>(userId: string, farmId: string, logId: string): T | null {
        try {
            const raw = storage()?.getItem(keyOf(userId, farmId, logId));
            return raw ? (JSON.parse(raw) as T) : null;
        } catch {
            return null;
        }
    },
    remove(userId: string, farmId: string, logId: string): void {
        try {
            storage()?.removeItem(keyOf(userId, farmId, logId));
        } catch {
            // The cache is disposable.
        }
    },
    /** The records this user has an entry for on this farm. */
    logIdsOf(userId: string, farmId: string): string[] {
        const s = storage();
        if (!s) return [];
        const mine = `${PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(farmId)}.`;
        const ids: string[] = [];
        try {
            for (let i = 0; i < s.length; i++) {
                const k = s.key(i);
                if (k !== null && k.startsWith(mine)) ids.push(decodeURIComponent(k.slice(mine.length)));
            }
        } catch {
            return [];
        }
        return ids;
    },
    /** Access to ONE farm ended: this user's entries for it go. */
    purgeFarm(userId: string, farmId: string): void {
        const doomed = `${PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(farmId)}.`;
        removeWhere((k) => !k.startsWith(doomed));
    },
    /** A different user is now active: everyone else's entries go. */
    purgeExceptUser(userId: string): void {
        const mine = `${PREFIX}${encodeURIComponent(userId)}.`;
        removeWhere((k) => k.startsWith(mine));
    },
    /** The session ended: every entry goes. */
    clearAll(): void {
        removeWhere(() => false);
    },
};
