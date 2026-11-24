/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 2;
 * SM-10; P2, P10) - what one work card of a followed schedule says about "माझ्या वेळापत्रकात घ्या", as this phone knows it.
 *   - the own work's id is the server's (`ownItemIdFor`: crop season + task key), so the SAME work in two schedules is ONE card with ONE answer;
 *   - taken = the server's own work is active, or a `schedule.take_task` waits in the outbox (kept on the phone, said so: queued intent is never drawn as saved);
 *   - a take the server refused is parked with its words; it never reads as taken;
 *   - the button shows on every card from today onward (a past day offers none);
 *   - when the work has several doses that differ, the farmer picks ONE (the server accepts only a dose the work states).
 * Pure helpers plus one live hook; nothing here writes.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { ownItemIdFor } from './ownWorkPlan';

/** The doses a work states, each once and in the order the work gives them: its own dose line, then its products' doses. */
export function doseChoicesOf(task: Pick<ScheduleTaskContent, 'dose' | 'products'>): string[] {
    const out: string[] = [];
    const add = (d: string | null | undefined) => {
        const v = d?.trim();
        if (v && !out.includes(v)) out.push(v);
    };
    add(task.dose);
    for (const p of task.products ?? []) add(p.doseAsWritten);
    return out;
}

/** Several doses that differ: the farmer picks one. One dose (or none) is nothing to pick. */
export const needsDosePick = (task: Pick<ScheduleTaskContent, 'dose' | 'products'>): boolean => doseChoicesOf(task).length > 1;

/**
 * The button shows on every work card from today onward. `dayStored` is the card's day (stored: shown - 1), `todayStored` today's stored day on the plot;
 * either unknown = shown (a card that names no day is never hidden by a guess).
 */
export const offersTake = (dayStored: number | null | undefined, todayStored: number | null | undefined): boolean =>
    dayStored === null || dayStored === undefined || todayStored === null || todayStored === undefined || dayStored >= todayStored;

export type TakeState =
    | { kind: 'none' }
    /** Waiting in the outbox (or being sent): the phone keeps it, the server has not answered. */
    | { kind: 'queued' }
    /** The server's own work is active. */
    | { kind: 'taken' }
    /** The server refused the take; `code` is its answer. */
    | { kind: 'refused'; code: string | null; message: string | null };

interface QueuedTake {
    status: string;
    payload: { cropCycleId?: unknown; taskKey?: unknown } | null;
    lastError?: string | null;
    errorCode?: string | null;
}

/** Where the take of `taskKey` stands, from the server's own work (`serverActive`) and the take rows in the outbox for this season. */
export function takeStateOf(serverActive: boolean, queued: readonly QueuedTake[], cropCycleId: string, taskKey: string): TakeState {
    if (serverActive) return { kind: 'taken' };
    const mine = queued.filter(q => q.payload?.cropCycleId === cropCycleId && q.payload?.taskKey === taskKey);
    if (mine.some(q => q.status === 'PENDING' || q.status === 'SENDING' || q.status === 'FAILED')) return { kind: 'queued' };
    const parked = mine.find(q => q.status === 'REJECTED_USER_REVIEW');
    if (parked) return { kind: 'refused', code: parked.errorCode ?? null, message: parked.lastError ?? null };
    return { kind: 'none' };
}

/** Live: the take state of one work of one plot-season. `null` until the first read. */
export function useTakeState(cropCycleId: string, taskKey: string): TakeState | null {
    const [state, setState] = useState<TakeState | null>(null);
    useEffect(() => {
        const db = getDatabase();
        const itemId = ownItemIdFor(cropCycleId, taskKey);
        const sub = liveQuery(async () => {
            const row = await db.ownScheduleItems.get(itemId);
            const queued = await db.mutationQueue.where('mutationType').equals(SyncMutationName.ScheduleTakeTask).toArray();
            // A removal waiting for the server (taken back on this phone) reads as not taken until the server answers.
            const removing = (await db.mutationQueue.where('mutationType').equals(SyncMutationName.OwnscheduleItemRemove).toArray())
                .some(q => (q.status === 'PENDING' || q.status === 'SENDING' || q.status === 'FAILED')
                    && (q.payload as { cropCycleId?: unknown; taskKey?: unknown } | null)?.cropCycleId === cropCycleId
                    && (q.payload as { taskKey?: unknown } | null)?.taskKey === taskKey);
            return takeStateOf(row?.state === 'active' && !removing, queued as unknown as QueuedTake[], cropCycleId, taskKey);
        }).subscribe({ next: setState, error: () => setState({ kind: 'none' }) });
        return () => sub.unsubscribe();
    }, [cropCycleId, taskKey]);
    return state;
}
