/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, row B4) — the server's last read of a record's product purposes,
 * held in memory so the product ROW can show the answer ("कशासाठी: …") while the question slot, a sibling far up the screen, owns
 * the read. The same reason `dfesAnswerSignal` exists: the two are siblings under a hook-free route render. Nothing is stored on the
 * phone and nothing is worked out here: what the row shows is exactly what the server last said (P10).
 */
import { useSyncExternalStore } from 'react';
import type { ProductPurposeAnswer, ProductPurposeItem } from './productPurposeApi';

type Listener = () => void;

const byLog = new Map<string, readonly ProductPurposeItem[]>();
const listeners = new Set<Listener>();

const keyOf = (eventId: string, mixIndex: number): string => `${eventId}:${mixIndex}`;

/** The question slot publishes each read (also an empty one, which clears what an earlier read said). */
export function publishProductPurposes(dailyLogId: string, items: readonly ProductPurposeItem[]): void {
    byLog.set(dailyLogId, items);
    listeners.forEach(listener => {
        try { listener(); } catch { /* one broken subscriber never stops the others */ }
    });
}

export function productPurposeAnswerOf(dailyLogId: string, eventId: string, mixIndex: number): ProductPurposeAnswer | null {
    const item = byLog.get(dailyLogId)?.find(i => keyOf(i.inputEventId, i.mixIndex) === keyOf(eventId, mixIndex));
    return item?.answer ?? null;
}

const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The stored answer for this product of this record, or null (none yet, or nothing read). */
export function useProductPurposeAnswer(dailyLogId: string | undefined, ref: { eventId: string; mixIndex: number } | undefined): ProductPurposeAnswer | null {
    return useSyncExternalStore(
        subscribe,
        () => (dailyLogId && ref ? productPurposeAnswerOf(dailyLogId, ref.eventId, ref.mixIndex) : null),
        () => null,
    );
}

export function __resetProductPurposeStoreForTests(): void {
    byLog.clear();
    listeners.clear();
}
