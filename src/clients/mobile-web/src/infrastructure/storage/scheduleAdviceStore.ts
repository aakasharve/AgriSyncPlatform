/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV Task 2; P10) - the last "what do my schedules say about this work"
 * answer for each farm + plot, kept in `appMeta` (no Dexie version bump; the `stagePlanStore` / `lastKnownSeats` precedent) so the plan
 * form's card still shows something true when there is no net: that answer, the words it was asked for, and the time the server gave it.
 *
 * WHOSE IT IS (the `lastKnownSeats` rule). The value is tagged with the id of the user who was signed in when it was written, and a
 * reader ignores a value whose id is not the current session's, or when the session's user id is not known. Each farmer has his own
 * database, but a write can land in whichever database is active at that moment, so the tag makes that harmless: an answer written for
 * the owner is never shown to a worker who signs in on the same phone. Nothing is written when no user id is known.
 *
 * One row per farm + plot; a 403 or a 404 (the plot is no longer his to plan) removes it. Presentation only: nothing here is ever copied
 * into a saved task (D-24d).
 */
import type { ScheduleAdviceDto } from '../api/scheduleAdviceDtos';
import { parseScheduleAdvice } from '../api/scheduleAdviceDtos';
import { getDatabase } from './DexieDatabase';

export const scheduleAdviceMetaKey = (farmId: string, plotId: string): string => `shramsafal_schedule_advice_v1:${farmId}:${plotId}`;

export interface StoredScheduleAdvice {
    userId: string;
    /** The words the answer was asked for (so the card never says it is about another work). */
    words: string;
    receivedAtUtc: string;
    advice: ScheduleAdviceDto;
}

/** The kept answer of this person for this plot, or null (none, another user's, or one that cannot be read). */
export async function readCachedScheduleAdvice(farmId: string, plotId: string, userId: string | null | undefined): Promise<StoredScheduleAdvice | null> {
    if (!userId) return null;
    try {
        const row = await getDatabase().appMeta.get(scheduleAdviceMetaKey(farmId, plotId));
        const value = row?.value as { userId?: unknown; words?: unknown; receivedAtUtc?: unknown; advice?: unknown } | undefined;
        if (!value || value.userId !== userId) return null;
        const advice = parseScheduleAdvice(value.advice);
        return advice && typeof value.words === 'string' && typeof value.receivedAtUtc === 'string'
            ? { userId, words: value.words, receivedAtUtc: value.receivedAtUtc, advice }
            : null;
    } catch {
        return null;
    }
}

export async function saveScheduleAdvice(farmId: string, plotId: string, userId: string | null | undefined, words: string, advice: ScheduleAdviceDto): Promise<void> {
    if (!userId) return;
    try {
        const receivedAtUtc = new Date().toISOString();
        await getDatabase().appMeta.put({ key: scheduleAdviceMetaKey(farmId, plotId), value: { userId, words, receivedAtUtc, advice }, updatedAt: receivedAtUtc });
    } catch {
        /* a blocked store only means nothing is kept for the next time without a net */
    }
}

export async function dropScheduleAdvice(farmId: string, plotId: string): Promise<void> {
    try {
        await getDatabase().appMeta.delete(scheduleAdviceMetaKey(farmId, plotId));
    } catch {
        /* nothing kept to remove */
    }
}
