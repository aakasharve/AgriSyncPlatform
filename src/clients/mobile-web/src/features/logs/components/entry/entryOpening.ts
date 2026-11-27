/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1a (CTO ruling 2). The first-record card's
 * "बोलायला सुरुवात करा" opens the log tab's OWN entry flow on the crop question — the very step "झालेले काम सांगा" opens
 * (`WorkHome.onTell`). The card is a first-run screen, so the log tab is not mounted yet when it is tapped; it leaves this
 * one-shot note, and the tab's `LogEntryFlow` reads it when it mounts and forgets it at once (the next visit opens on the
 * work home as always). The same one-shot pattern as `features/labour/labourOpening.ts`. State only: no React, no storage.
 */
export type EntryOpening = 'crop';

let pending: EntryOpening | null = null;

/** The next mount of the log tab's entry flow opens on the crop question. */
export function requestEntryOpening(): void {
    pending = 'crop';
}

/** What the entry flow was asked to open on (read when it mounts). */
export function peekEntryOpening(): EntryOpening | null {
    return pending;
}

/** Forget it: read once, never again. */
export function clearEntryOpening(): void {
    pending = null;
}
