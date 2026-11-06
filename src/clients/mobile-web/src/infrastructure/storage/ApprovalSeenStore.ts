/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10 (I28, lane L4b; founder D-46 §3) — what the reviewer SAW when he tapped मंजूर, kept on this phone
 * only so that, if the server answers "this record changed", the sheet can say what changed. A disposable cache
 * (doctrine P10: never business truth, never sent anywhere): when it is missing the change is shown without the
 * old values. Every access is guarded — private mode or full storage only loses the "before" half.
 */
const PREFIX = 'agrisync.approval.seen.';

export const ApprovalSeenStore = {
    write(logId: string, value: unknown): void {
        try {
            window.localStorage.setItem(PREFIX + logId, JSON.stringify(value));
        } catch {
            // Nothing is lost that the server does not hold.
        }
    },
    read<T>(logId: string): T | null {
        try {
            const raw = window.localStorage.getItem(PREFIX + logId);
            return raw ? (JSON.parse(raw) as T) : null;
        } catch {
            return null;
        }
    },
    remove(logId: string): void {
        try {
            window.localStorage.removeItem(PREFIX + logId);
        } catch {
            // The cache is disposable.
        }
    },
};
