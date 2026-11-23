// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main") - the rows of the Dexie `ownScheduleItems` and
// `ownScheduleItemRevisions` stores (schema v30), kept apart from DexieDatabase.types.ts (mobile-web 800-line cap).
//
// SERVER CACHE ONLY (P10): one row = one work of a plot-season's own schedule, or one save / removal of it, exactly as the server holds it (pull keys
// `ownScheduleItems` / `ownScheduleItemRevisions`, FULL on every pull, sent only to a phone that asks for the new format and only for a farm the schedule
// mechanism is switched on for). A change made on this phone and not yet answered is NOT a row here: it stays in the mutation queue, and
// `getLocalOwnSchedule` (features/scheduler/ownSchedule/ownScheduleLocal.ts) shows the two together with a label, so queued intent is never drawn as saved.
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../sync-contract/schemas/schedule-task.zod';

export type OwnScheduleItemStateName = 'active' | 'removed';

export interface OwnScheduleItemRow {
    /** The server's id: a UUIDv5 of the crop season and the task key (the same on every phone). */
    id: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    taskKey: string;
    /** The number of the newest revision on the server. */
    revision: number;
    state: OwnScheduleItemStateName;
    task: ScheduleTaskContent;
    contentHash: string;
    origin: string | null;
    /** The version the season's works were last frozen into by "हेच मुख्य करा"; null while it is only being built. */
    mainVersionId: string | null;
    updatedAtUtc: string;
}

export interface OwnScheduleItemRevisionRow {
    id: string;
    itemId: string;
    farmId: string;
    plotId: string;
    cropCycleId: string;
    taskKey: string;
    revisionNumber: number;
    action: 'saved' | 'removed';
    state: OwnScheduleItemStateName;
    task: ScheduleTaskContent;
    contentHash: string;
    byUserId: string;
    atUtc: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;

/** One pull row as a Dexie row, or null when it cannot be read (an unreadable task is skipped, never shown half). */
export function ownScheduleItemRowFromDto(input: unknown): OwnScheduleItemRow | null {
    if (typeof input !== 'object' || input === null) return null;
    const d = input as Record<string, unknown>;
    if (!isText(d.id) || !isText(d.farmId) || !isText(d.plotId) || !isText(d.cropCycleId) || !isText(d.taskKey)
        || !isWhole(d.revision) || (d.state !== 'active' && d.state !== 'removed') || !isText(d.contentHash) || !isText(d.updatedAtUtc)) {
        return null;
    }
    const task = parseScheduleTask(d.task);
    if (!task.ok) return null;
    return {
        id: d.id,
        farmId: d.farmId,
        plotId: d.plotId,
        cropCycleId: d.cropCycleId,
        taskKey: d.taskKey,
        revision: d.revision,
        state: d.state,
        task: task.value,
        contentHash: d.contentHash,
        origin: typeof d.origin === 'string' ? d.origin : null,
        mainVersionId: typeof d.mainVersionId === 'string' ? d.mainVersionId : null,
        updatedAtUtc: d.updatedAtUtc,
    };
}

/** One pull revision as a Dexie row, or null when it cannot be read. */
export function ownScheduleRevisionRowFromDto(input: unknown): OwnScheduleItemRevisionRow | null {
    if (typeof input !== 'object' || input === null) return null;
    const d = input as Record<string, unknown>;
    if (!isText(d.id) || !isText(d.itemId) || !isText(d.farmId) || !isText(d.plotId) || !isText(d.cropCycleId) || !isText(d.taskKey)
        || !isWhole(d.revisionNumber) || (d.action !== 'saved' && d.action !== 'removed') || (d.state !== 'active' && d.state !== 'removed')
        || !isText(d.contentHash) || !isText(d.byUserId) || !isText(d.atUtc)) {
        return null;
    }
    const task = parseScheduleTask(d.task);
    if (!task.ok) return null;
    return {
        id: d.id,
        itemId: d.itemId,
        farmId: d.farmId,
        plotId: d.plotId,
        cropCycleId: d.cropCycleId,
        taskKey: d.taskKey,
        revisionNumber: d.revisionNumber,
        action: d.action,
        state: d.state,
        task: task.value,
        contentHash: d.contentHash,
        byUserId: d.byUserId,
        atUtc: d.atUtc,
    };
}
