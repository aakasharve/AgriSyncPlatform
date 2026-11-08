/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1) - the "पाहिलं" he tapped on an "आधी हे पाहा" card, remembered
 * on this phone so the card leaves every surface at once, offline included. Same pattern as a confirmed "पुढे ठरवा"
 * (`scheduledWork.ts` `markRescheduled`): the card is hidden only while the board on the phone is OLDER than the tap. A newer pull
 * that still lists the signal is the server's word (it refused, or has not taken it yet) and wins.
 *
 * Nothing here is a record: the stored log is never touched (P7).
 */
const seenAt = new Map<string, number>();
const listeners = new Set<() => void>();

export function markSignalSeen(signalId: string, at: number = Date.now()): void {
    seenAt.set(signalId, at);
    listeners.forEach(l => l());
}

/** A snapshot for the pure list builder (a copy: the builder never sees later changes). */
export function seenSignalsSnapshot(): ReadonlyMap<string, number> {
    return new Map(seenAt);
}

export function onSeenSignalsChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Tests only. */
export function clearSeenSignalsForTests(): void {
    seenAt.clear();
}
