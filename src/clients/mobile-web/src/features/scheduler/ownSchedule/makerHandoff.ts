/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 1; founder D-132 Q1 = 1 "entry only from planning") - the one-shot hand-off from the
 * शेड्यूल page's live button (or the ask card's) to planning: "open the maker, on this crop". The button writes nothing and decides nothing; it asks to
 * go, and planning - which knows the seat - opens the maker or, for a seat without the authority, ignores the ask (fail closed). Held in memory only:
 * a request that nobody takes is gone with the page.
 */
let pending: { cropId: string | null } | null = null;

export function requestOwnScheduleMaker(cropId?: string | null): void {
    pending = { cropId: cropId ?? null };
}

/** Takes the request (it is only ever taken once). */
export function takeOwnScheduleMakerRequest(): { cropId: string | null } | null {
    const request = pending;
    pending = null;
    return request;
}
