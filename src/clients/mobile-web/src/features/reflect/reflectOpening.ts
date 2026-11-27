/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The day-3 card ("काल काय केलं ते पाहा") opens आढावा
 * on THAT day. आढावा is not mounted while Home is on screen, so the card leaves this one-shot note; the page reads it when it
 * mounts and forgets it at once (the next visit opens on today, as always). The same one-shot pattern as
 * `features/logs/components/entry/entryOpening.ts`. State only: no React, no storage.
 */
let pending: string | null = null;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The next mount of आढावा opens on this day (`YYYY-MM-DD`). Anything that is not a day key is ignored. */
export function requestReflectDay(dateKey: string): void {
    pending = DATE_KEY.test(dateKey) ? dateKey : null;
}

/** The day आढावा was asked to open on (read when it mounts). */
export function peekReflectDay(): string | null {
    return pending;
}

/** Forget it: read once, never again. */
export function clearReflectDay(): void {
    pending = null;
}
