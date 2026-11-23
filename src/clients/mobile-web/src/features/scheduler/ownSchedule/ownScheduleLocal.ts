// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main"; P10) - a plot-season's own schedule AS THIS PHONE KNOWS IT:
// the server's works (Dexie `ownScheduleItems`, the truth) with this phone's unanswered saves and removals laid over them in the order they were made, each
// work marked `pending` while a change of it waits, and `refused` when the server parked one. Queued intent is never drawn as saved (P10).
// No screen reads it in this slice; the maker (slice 4) does.
import type { AgriLogDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';
import type { OwnScheduleItemStateName } from '../../../infrastructure/storage/ownScheduleItemRow';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { ScheduleTaskContent } from '../../../../../../../sync-contract/schemas/schedule-task.zod';

export interface LocalOwnScheduleWork {
    taskKey: string;
    task: ScheduleTaskContent;
    state: OwnScheduleItemStateName;
    /** The newest revision on the server, or null for a work only this phone has. */
    serverRevision: number | null;
    /** A change of this work is still waiting to reach the server. */
    pending: boolean;
    /** The server refused a change of this work (it is parked with its words on the conflict page). */
    refused: boolean;
}

const WAITING: ReadonlySet<MutationQueueStatus> = new Set<MutationQueueStatus>(['PENDING', 'SENDING', 'FAILED']);
const PARKED: MutationQueueStatus = 'REJECTED_USER_REVIEW';

export async function getLocalOwnSchedule(db: AgriLogDatabase, cropCycleId: string): Promise<LocalOwnScheduleWork[]> {
    const server = await db.ownScheduleItems.where('cropCycleId').equals(cropCycleId).toArray();
    const works = new Map<string, LocalOwnScheduleWork>(server.map(row => [row.taskKey, {
        taskKey: row.taskKey, task: row.task, state: row.state, serverRevision: row.revision, pending: false, refused: false,
    }]));

    const queued = (await db.mutationQueue
        .where('mutationType').anyOf([SyncMutationName.OwnscheduleItemSave, SyncMutationName.OwnscheduleItemRemove])
        .filter(row => WAITING.has(row.status) || row.status === PARKED)
        .toArray())
        .filter(row => (row.payload as { cropCycleId?: unknown } | null)?.cropCycleId === cropCycleId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id ?? 0) - (b.id ?? 0));

    for (const row of queued) {
        const payload = row.payload as { task?: ScheduleTaskContent; taskKey?: string };
        const key = row.mutationType === SyncMutationName.OwnscheduleItemSave ? payload.task?.taskKey : payload.taskKey;
        if (typeof key !== 'string') continue;
        const existing = works.get(key);
        if (row.status === PARKED) {
            if (existing) existing.refused = true;
            continue; // a refused change has not happened: nothing of it is laid over the server's work
        }
        if (row.mutationType === SyncMutationName.OwnscheduleItemSave && payload.task) {
            works.set(key, { taskKey: key, task: payload.task, state: 'active', serverRevision: existing?.serverRevision ?? null, pending: true, refused: existing?.refused ?? false });
        } else if (existing) {
            works.set(key, { ...existing, state: 'removed', pending: true });
        }
    }

    return [...works.values()].sort((a, b) => a.task.stageIndex - b.task.stageIndex || a.task.order - b.task.order || a.taskKey.localeCompare(b.taskKey));
}
