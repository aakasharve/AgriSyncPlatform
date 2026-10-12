/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * earlyAccess — founder-only activation of the per-device attendance-door
 * switch (attendanceDoor.ts). Two ways, neither adds farmer-facing UI:
 *   1. 7 quick taps (within 3 s) on the app version label.
 *   2. Web only: `?early=attendance` / `?early=attendance-off`, consumed once
 *      and stripped from the URL.
 * The toast text is founder-only, in plain Marathi (founder decision 2026-10-12).
 * spec: 2026-08-25-prod-cutover-waves
 */
import { isAttendanceDoorEnabled, setAttendanceDoorEnabled } from './attendanceDoor';

export const EARLY_TAP_COUNT = 7;
export const EARLY_TAP_WINDOW_MS = 3000;

export function earlyAccessToastText(on: boolean): string {
    return `हजेरीचं नवं दार: ${on ? 'चालू' : 'बंद'}`;
}

/** Makes a tap handler; the 7th tap in the window toggles and returns the new state, else null. */
export function createEarlyAccessTapHandler(now: () => number = Date.now): () => boolean | null {
    let stamps: number[] = [];
    return () => {
        const t = now();
        stamps = stamps.filter((s) => t - s <= EARLY_TAP_WINDOW_MS);
        stamps.push(t);
        if (stamps.length < EARLY_TAP_COUNT) return null;
        stamps = [];
        const next = !isAttendanceDoorEnabled();
        setAttendanceDoorEnabled(next);
        return next;
    };
}

/** Applies and strips `?early=attendance[-off]`. Returns the applied state or null. Never throws. */
export function consumeEarlyAccessUrlParam(): boolean | null {
    try {
        if (typeof window === 'undefined') return null;
        const url = new URL(window.location.href);
        const v = url.searchParams.get('early');
        if (v === null) return null;
        url.searchParams.delete('early');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        if (v === 'attendance') { setAttendanceDoorEnabled(true); return true; }
        if (v === 'attendance-off') { setAttendanceDoorEnabled(false); return false; }
        return null;
    } catch {
        return null;
    }
}
