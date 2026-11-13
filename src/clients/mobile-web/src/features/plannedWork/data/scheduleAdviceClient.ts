/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ADV Task 2; D-74 note, D-87 = 1, D-83 = 1, D-24d; R12, R28; P4, P9, P10)
 * - the phone client of `GET /shramsafal/farms/{farmId}/plots/{plotId}/schedule-advice` (the server counts and recognises the work; the
 * phone only asks and shows). Asked while he plans a work, once the three answers (the work, the place, the day) are there:
 *
 *   - an answer that reads is shown and kept for that farm + plot, tagged with the signed-in user (`scheduleAdviceStore`);
 *   - no net (the device says so, or the request never arrived): the kept answer with the time it was received, else "offline";
 *   - a 404 or a 403 (the plot is not his to plan - the server never says which): NOTHING is drawn and what was kept is forgotten;
 *   - any other error, or an answer that cannot be read: NOTHING is drawn - never a fake, never a card with a number missing.
 * One request per pause in his typing (`debounceMs`), never one per keystroke; an answer that arrives after he changed the question is
 * dropped. Nothing here reads or writes a task: the card is advice only and none of it is ever copied into the saved task (D-24d).
 */
import { useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { parseScheduleAdvice, type ScheduleAdviceDto } from '../../../infrastructure/api/scheduleAdviceDtos';
import { onActiveDatabaseChanged } from '../../../infrastructure/storage/activeDatabaseName';
import { dropScheduleAdvice, readCachedScheduleAdvice, saveScheduleAdvice } from '../../../infrastructure/storage/scheduleAdviceStore';

export const scheduleAdvicePath = (farmId: string, plotId: string): string => `/shramsafal/farms/${farmId}/plots/${plotId}/schedule-advice`;

/** What he is asking about: one plot, his words for the work, and either the planned day or a loose "when". */
export interface ScheduleAdviceAsk {
    farmId: string;
    plotId: string;
    /** The signed-in person (the kept answer is theirs only). */
    userId: string;
    words: string;
    plannedDate?: string;
    looseWhen?: 'Week' | 'Month' | 'Anytime';
}

export type ScheduleAdviceResult =
    | { kind: 'advice'; advice: ScheduleAdviceDto; source: 'server' | 'cache'; receivedAtUtc: string; words: string }
    | { kind: 'offline' }
    | { kind: 'none' };

const NONE: ScheduleAdviceResult = { kind: 'none' };

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } } | null)?.response?.status;

/**
 * `isCurrent` (the hook passes it): false once the question changed or the card went away. A response that arrives after that is neither
 * shown nor KEPT - an older answer finishing last must never overwrite the kept offline answer of the newer question.
 */
export async function loadScheduleAdvice(ask: ScheduleAdviceAsk, isCurrent: () => boolean = () => true): Promise<ScheduleAdviceResult> {
    const keptOrOffline = async (): Promise<ScheduleAdviceResult> => {
        const kept = await readCachedScheduleAdvice(ask.farmId, ask.plotId, ask.userId);
        return kept
            ? { kind: 'advice', advice: kept.advice, source: 'cache', receivedAtUtc: kept.advice.serverTimeUtc || kept.receivedAtUtc, words: kept.words }
            : { kind: 'offline' };
    };

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return keptOrOffline();
    try {
        const params: Record<string, string> = { words: ask.words };
        if (ask.looseWhen) params.loose = ask.looseWhen;
        else if (ask.plannedDate) params.date = ask.plannedDate;
        const response = await agriSyncClient.http.get<unknown>(scheduleAdvicePath(ask.farmId, ask.plotId), { params });
        const advice = parseScheduleAdvice(response.data);
        if (!advice || !isCurrent()) return NONE;
        await saveScheduleAdvice(ask.farmId, ask.plotId, ask.userId, ask.words, advice);
        return { kind: 'advice', advice, source: 'server', receivedAtUtc: advice.serverTimeUtc, words: ask.words };
    } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 403) {
            await dropScheduleAdvice(ask.farmId, ask.plotId);
            return NONE;
        }
        if (status === undefined) return keptOrOffline(); // the request never reached the server: no net
        return NONE;
    }
}

/** The pause in his typing before the server is asked (a request per keystroke would drown a slow phone). */
export const ADVICE_DEBOUNCE_MS = 600;

const keyOf = (a: ScheduleAdviceAsk): string => [a.farmId, a.plotId, a.userId, a.words, a.plannedDate ?? '', a.looseWhen ?? ''].join('|');

/**
 * The answer for one question, asked after a pause, again when the question changes, and re-bound when the active phone database
 * changes (a sign-out / sign-in on the same phone - the kept answer of the old person is never read for the new one). `undefined` while
 * nothing is asked or the answer is on its way. Never throws.
 */
export function useScheduleAdvice(ask: ScheduleAdviceAsk | null, debounceMs: number = ADVICE_DEBOUNCE_MS): ScheduleAdviceResult | undefined {
    const [result, setResult] = useState<{ key: string; value: ScheduleAdviceResult } | undefined>(undefined);
    const [dbEpoch, setDbEpoch] = useState(0);
    useEffect(() => onActiveDatabaseChanged(() => { setResult(undefined); setDbEpoch(n => n + 1); }), []);

    const key = ask ? `${keyOf(ask)}#${dbEpoch}` : '';
    const askKey = ask ? keyOf(ask) : '';
    useEffect(() => {
        if (!ask) return undefined;
        let alive = true;
        const timer = setTimeout(() => {
            void loadScheduleAdvice(ask, () => alive).then(
                value => { if (alive) setResult({ key, value }); },
                () => { if (alive) setResult({ key, value: NONE }); },
            );
        }, debounceMs);
        return () => { alive = false; clearTimeout(timer); };
        // `ask` is a fresh object each render; its content is `askKey`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [askKey, dbEpoch, debounceMs]);
    return ask && result?.key === key ? result.value : undefined;
}
