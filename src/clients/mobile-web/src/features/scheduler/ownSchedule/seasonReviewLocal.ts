/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; P3, P8, P10) - what this phone knows about the season-end review of one
 * plot, read live: the season that ended (the newest OLDER season with an own work), the answers the server kept (`referenceData` `ownScheduleCarries`, the pull's
 * key), an answer still waiting in the outbox (kept on the phone, never drawn as saved), and the review's list. Fails soft: an unreadable store is "nothing to ask".
 * Nothing here writes.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { LocalPlannedWork } from '../../plannedWork/data/plannedWorkStore';
import { getLocalOwnSchedule } from './ownScheduleLocal';
import { buildSeasonReview, originNameOf, previousSeasonWithWork, type CarryRow, type SeasonReviewModel } from './seasonReviewModel';

export type SeasonReviewState =
    /** Nothing to ask: no older season with own works, or the season has no newer pruning yet. */
    | { kind: 'none' }
    /** The pair was answered on the server (or on another phone): the review is asked once and never pops again; it stays reachable to read. */
    | { kind: 'answered'; fromCropCycleId: string; rows: CarryRow[] }
    /** This phone queued the answers and the server has not answered yet (kept on the phone). */
    | { kind: 'queued'; fromCropCycleId: string }
    /** To ask: the list. */
    | { kind: 'ask'; fromCropCycleId: string; model: SeasonReviewModel; originNames: Record<string, string | null> };

const WAITING = new Set(['PENDING', 'SENDING', 'FAILED']);

export async function readSeasonReview(
    farmId: string, plotId: string, currentCycleId: string, plans: readonly LocalPlannedWork[],
): Promise<SeasonReviewState> {
    try {
        const db = getDatabase();
        const cycles = (await db.cropCycles.where('plotId').equals(plotId).toArray())
            .map(r => ({ id: r.id, start: String((r.payload as { startDate?: string } | null)?.startDate ?? '') }));
        const withWork = new Set((await db.ownScheduleItems.toArray()).filter(i => i.plotId === plotId && i.state === 'active').map(i => i.cropCycleId));
        const from = previousSeasonWithWork(cycles, currentCycleId, id => withWork.has(id));
        if (!from) return { kind: 'none' };

        const carriesRaw = (await db.referenceData.get('ownScheduleCarries'))?.data;
        const rows: CarryRow[] = (Array.isArray(carriesRaw) ? carriesRaw : [])
            .filter((r): r is CarryRow => !!r && typeof r === 'object' && (r as CarryRow).plotId === plotId
                && (r as CarryRow).fromCropCycleId === from && (r as CarryRow).cropCycleId === currentCycleId);
        if (rows.length > 0) return { kind: 'answered', fromCropCycleId: from, rows };

        const queued = (await db.mutationQueue.where('mutationType').equals(SyncMutationName.OwnscheduleCarryForward).toArray())
            .some(q => WAITING.has(q.status) && (q.payload as { fromCropCycleId?: unknown; toCropCycleId?: unknown } | null)?.fromCropCycleId === from
                && (q.payload as { toCropCycleId?: unknown } | null)?.toCropCycleId === currentCycleId);
        if (queued) return { kind: 'queued', fromCropCycleId: from };

        const works = await getLocalOwnSchedule(db, from);
        const mine = plans.filter(p => p.farmId === farmId);
        const logIds = new Set(mine.flatMap(p => p.linkedDailyLogIds ?? []));
        const logDays = new Map<string, string>();
        for (const id of logIds) {
            const row = await db.logs.get(id);
            if (row?.date) logDays.set(id, row.date);
        }
        const fromStart = cycles.find(c => c.id === from)?.start ?? '';
        const sub = (await db.scheduleSubscriptions.where('plotId').equals(plotId).toArray())
            .filter(s => s.cropCycleId === from && s.referenceDate)
            .sort((a, b) => a.adoptedAtUtc.localeCompare(b.adoptedAtUtc))[0];
        const dayZero = (sub?.referenceDate ?? fromStart).slice(0, 10);
        const model = buildSeasonReview({
            works: works.map(w => ({ taskKey: w.taskKey, task: w.task, state: w.state })),
            plans: mine,
            logDays,
            dayZero,
            cropCycleId: from,
        });
        if (model.questions.length === 0 && model.planOnly.length === 0) return { kind: 'none' };
        const templates = (await db.referenceData.get('scheduleTemplates'))?.data;
        const originNames: Record<string, string | null> = {};
        for (const w of works) originNames[w.taskKey] = originNameOf(w.task.origin, Array.isArray(templates) ? templates : []);
        return { kind: 'ask', fromCropCycleId: from, model, originNames };
    } catch {
        return { kind: 'none' };
    }
}

/** Live: the review state of one plot's current season. `null` until the first read. */
export function useSeasonReview(
    farmId: string | null, plotId: string | null, currentCycleId: string | null, plans: readonly LocalPlannedWork[],
): SeasonReviewState | null {
    const [state, setState] = useState<SeasonReviewState | null>(null);
    useEffect(() => {
        if (!farmId || !plotId || !currentCycleId) { setState({ kind: 'none' }); return undefined; }
        const sub = liveQuery(() => readSeasonReview(farmId, plotId, currentCycleId, plans)).subscribe({ next: setState, error: () => setState({ kind: 'none' }) });
        return () => sub.unsubscribe();
    }, [farmId, plotId, currentCycleId, plans]);
    return state;
}
