/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * unlockSpeechStore — Task 8 (spec: dfes-companion-2026-07-11). Synchronous
 * localStorage adapter for the "has Sathi already spoken the unlock reward
 * for this farm" once-ever guard. Mirrors NotificationNudgeStore's
 * was*Sent/mark*Sent pattern: LedgerRecognitionPanel remounts on every
 * save, so a React ref can't survive between saves — this must be
 * durable storage (also survives app restarts).
 */

const UNLOCK_SPOKEN_PREFIX = 'shramsafal.unlock_spoken';

function hasLocalStorage(): boolean {
    return typeof window !== 'undefined' && !!window.localStorage;
}

export function wasUnlockSpoken(farmId: string): boolean {
    if (!hasLocalStorage()) {
        return false;
    }
    try {
        return window.localStorage.getItem(`${UNLOCK_SPOKEN_PREFIX}.${farmId}`) === '1';
    } catch {
        return false;
    }
}

export function markUnlockSpoken(farmId: string): void {
    if (!hasLocalStorage()) {
        return;
    }
    try {
        window.localStorage.setItem(`${UNLOCK_SPOKEN_PREFIX}.${farmId}`, '1');
    } catch {
        // Swallow — a failed write just means the reward may repeat once;
        // never let storage errors surface to the caller.
    }
}
