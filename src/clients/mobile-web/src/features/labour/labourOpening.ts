/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 (founder ATT-LOG, 2026-10-31) — the log page's हजेरी card, once today's work and headcount are both told,
 * opens the हजेरी place straight on its names screen ("इथे हजेरी घ्या — आज N जण" → the names). The labour route takes
 * no arguments, so the card leaves this one-shot note just before opening the place; `LabourFeature` reads it when it
 * mounts and forgets it at once, so the next ordinary visit (सेट-अप केंद्र, the "हजेरी वही बघा" link) opens the hub as
 * always. State only, like the ONE mic's store: no React, no storage.
 */
export type LabourOpening = 'names';

let pending: LabourOpening | null = null;

/** The next mount of the हजेरी place opens on this screen. */
export function requestLabourOpening(screen: LabourOpening): void {
    pending = screen;
}

/** What the place was asked to open on (read when it mounts). */
export function peekLabourOpening(): LabourOpening | null {
    return pending;
}

/** Forget it: read once, never again. */
export function clearLabourOpening(): void {
    pending = null;
}
