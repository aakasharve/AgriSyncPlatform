/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 4; founder D-1, D-29, D-31, P3, P10) - the ONE-TIME UPLOAD of the old
 * local to-do list.
 *
 * Before this lane, the to-dos typed on आढावा lived only on the phone (`appMeta` `agrisync_local_planned_tasks_v1`). Now the server
 * keeps them. So, once per sign-in and farm, after the first successful sync, every OPEN old to-do the server does not have yet is
 * queued as `plannedwork.create`, his own reminder (typed; no assignee):
 *   - the id is derived from the OLD to-do's id (`legacyTodoTaskId`): running it twice is the same change, never a second task;
 *   - a to-do for the whole farm (`FARM_GLOBAL`) -> scope Farm; one on a plot -> that plot, but only if the plot is on THIS farm, else
 *     "not fixed" (Unspecified) - a place of another farm is never trusted;
 *   - its day is the old to-do's own day, if it had one - EXCEPT an old typed reminder (`observation_derived`), whose "day" was the log's day
 *     (today by default, D-29): that arrives undated (the server's "made on" day is the server's own: an old to-do may be weeks old);
 *   - done and cancelled to-dos are NOT uploaded; schedule work was never a to-do (no creating door).
 * The old copy stays until the server ACKNOWLEDGES each item (the server's row is here, or the create was applied), item by item. A create
 * the server REFUSED is parked with its refusal words on the conflict page and stays on the plan list; its old copy is kept and nothing is
 * deleted (P10: never silently dropped). Nothing here touches a Dexie version: the "uploaded" marker is one more `appMeta` row per farm.
 *
 * Concurrent runs are serialised (one at a time, in this tab) and the queue key is the same for the same to-do, so two runs can never
 * queue two creates.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import type { PlannedTask } from '../../../types';
import { PlannedWorkCommands } from './plannedWorkCommands';
import { legacyTodoTaskId } from './plannedWorkIds';
import { PLANNED_WORK_CHANGED_EVENT } from './spokenMirror';

/** The old local list (never renamed: it is how the first version stored it). */
export const LEGACY_TODOS_KEY = 'agrisync_local_planned_tasks_v1';

/** The per-farm marker: every open old to-do was acknowledged by the server. */
export const legacyUploadMarkerKey = (farmId: string): string => `agrisync_local_planned_tasks_uploaded_v1:${farmId}`;

export interface LegacyUploadArgs {
    farmId: string;
    /** The plot ids of this farm: an old to-do names a plot only if it is one of these. Absent = read from the synced plots of the farm. */
    knownPlotIds?: ReadonlySet<string>;
}

export interface LegacyUploadResult {
    /** Creates queued by THIS run. */
    queued: number;
    /** Old to-dos the server has acknowledged (and that this run therefore removed from the old copy). */
    acknowledged: number;
    /** Open old to-dos still waiting for the server (queued, parked, or not yet acknowledged). */
    waiting: number;
}

const isOldTodo = (value: unknown): value is PlannedTask =>
    typeof value === 'object' && value !== null && typeof (value as PlannedTask).id === 'string' && (value as PlannedTask).id.length > 0
    && typeof (value as PlannedTask).title === 'string';

const isOpen = (task: PlannedTask): boolean => task.status !== 'done' && task.status !== 'cancelled';

const dayOf = (value: string | undefined): string | undefined => {
    const day = value?.slice(0, 10);
    return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
};

/** One at a time: a run waits for the one before it. The result of a run that is already waiting is shared. */
let chain: Promise<unknown> = Promise.resolve();
const waitingFor = new Map<string, Promise<LegacyUploadResult>>();

export function uploadLegacyTodos(args: LegacyUploadArgs): Promise<LegacyUploadResult> {
    const existing = waitingFor.get(args.farmId);
    if (existing) return existing;
    const run = chain.then(() => runUpload(args), () => runUpload(args));
    const guarded = run.finally(() => { waitingFor.delete(args.farmId); });
    waitingFor.set(args.farmId, guarded);
    chain = guarded.catch(() => undefined);
    return guarded;
}

async function isAcknowledged(newId: string, farmId: string): Promise<boolean> {
    const db = getDatabase();
    const held = await db.plannedWork.get(newId);
    if (held && held.farmId === farmId && held.mirror !== true) return true;
    const key = PlannedWorkCommands.requestIdFor('create', newId);
    const sent = await db.mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), key]).first();
    return sent?.status === 'APPLIED';
}

async function runUpload({ farmId, knownPlotIds: given }: LegacyUploadArgs): Promise<LegacyUploadResult> {
    const db = getDatabase();
    // The farm's plots as the sync filled them (reference data), not as a screen holds them: right after a sync a screen may not have them yet.
    const knownPlotIds = given ?? new Set((await db.plots.where('farmId').equals(farmId).toArray()).map(p => p.id));
    const stored = await db.appMeta.get(LEGACY_TODOS_KEY);
    const old = Array.isArray(stored?.value) ? (stored!.value as unknown[]).filter(isOldTodo) : [];
    let queued = 0;
    let acknowledged = 0;
    let waiting = 0;
    const gone = new Set<string>();

    for (const todo of old) {
        if (!isOpen(todo) || todo.sourceType === 'schedule') continue; // done / cancelled / schedule work: never uploaded
        const title = todo.title.trim().slice(0, 200);
        if (!title) continue;
        const newId = legacyTodoTaskId(todo.id);

        if (await isAcknowledged(newId, farmId)) {
            gone.add(todo.id);
            acknowledged++;
            continue;
        }

        waiting++;
        const key = PlannedWorkCommands.requestIdFor('create', newId);
        const already = await db.mutationQueue.where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), key]).first();
        if (already) continue; // queued before (waiting, parked, or being sent): the same change, never a second one

        const plot = todo.plotId && knownPlotIds.has(todo.plotId) ? todo.plotId : null;
        const scope = plot ? 'Plot' as const : (!todo.plotId || todo.plotId === 'FARM_GLOBAL') ? 'Farm' as const : 'Unspecified' as const;
        await PlannedWorkCommands.create({
            plannedWorkId: newId,
            farmId,
            title,
            scope,
            plotIds: plot ? [plot] : [],
            // L006 (D-29): an old typed reminder (`observation_derived`) was filed under the log's day - "today by default" - so that day is not
            // a cue he gave: it arrives undated. A manual / spoken to-do keeps the day it really had.
            plannedDate: todo.sourceType === 'observation_derived' ? undefined : dayOf(todo.dueDate),
            sourceKind: 'Typed',
        });
        queued++;
    }

    if (gone.size > 0) {
        // The server has these: they leave the old copy. Everything else stays exactly as it was.
        const fresh = await db.appMeta.get(LEGACY_TODOS_KEY);
        const rest = Array.isArray(fresh?.value) ? (fresh!.value as unknown[]).filter(item => !(isOldTodo(item) && gone.has(item.id))) : [];
        await db.appMeta.put({ key: LEGACY_TODOS_KEY, value: rest, updatedAt: new Date().toISOString() });
    }

    if (waiting === 0) {
        await db.appMeta.put({ key: legacyUploadMarkerKey(farmId), value: { done: true }, updatedAt: new Date().toISOString() });
    }
    if (queued > 0 && typeof window !== 'undefined') window.dispatchEvent(new Event(PLANNED_WORK_CHANGED_EVENT));
    return { queued, acknowledged, waiting };
}

/** Has this farm's upload finished (every open old to-do acknowledged)? */
export async function legacyUploadIsDone(farmId: string): Promise<boolean> {
    const marker = await getDatabase().appMeta.get(legacyUploadMarkerKey(farmId));
    return (marker?.value as { done?: boolean } | undefined)?.done === true;
}
