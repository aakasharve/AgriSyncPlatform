/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c, D-26, D-79) - the SERVER WINS on download.
 *
 * The pull carries `plannedWork`: the farm's tasks and reminders changed since this phone's cursor, each AS THIS PERSON MAY SEE
 * IT (the server follows the reader's rights; nothing here widens that). They are kept in Dexie `plannedWork` (schema v28):
 *   1. every row the server sent replaces the phone's copy of that task (by id);
 *   2. a FULL pull (cursor '0') IS the whole list, so a server copy of a task on a farm the answer reads, that the answer no
 *      longer carries, is no longer his (a seat narrowed, a SeeAllTasks switched off): it goes (my call: the same sweep as
 *      `withdrawnRecordsReconciler` makes for records);
 *   3. a task on a farm the answer no longer lets him read goes with that farm (the accessScopes the pull carries);
 *   4. (fix round 1, L001) on a farm he still reads, the phone keeps ONLY what the CURRENT scope lets him see: the scope entry
 *      carries `seeAllTasks` (the server computes it with the clock, so an expired grant arrives as false) and, for chosen
 *      plots, `plotIds`. `visiblePlotIds` mirrors the server's `PlannedWorkVisibility.VisiblePlots` line for line, for REMOVAL
 *      ONLY: a row he may no longer see goes, a kept row's plot rows are trimmed to his plots, and nothing is ever shown that
 *      the server did not send. The MU-3 / MU-4 precedent (accessScopeReconciler, plotScopePurge). Never a row with a change
 *      still in the outbox (P10); nothing when the signed-in person is unknown or the field is absent (an older server).
 * A task TAKEN from him by a reassign is named in `withdrawnRecords` (kind "PlannedWork") and removed by
 * `reconcileWithdrawnRecords`, not here.
 *
 * Nothing unsent is ever a row here: a change made on this phone and not yet answered is a queued mutation, and
 * `getLocalPlannedWork` merges the two with a label (P10), so nothing this step removes is the farmer's unsent intent.
 * An older server sends no key: nothing is received, nothing is removed (P11).
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../../infrastructure/api/plannedWorkDtos';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/accessScopeDtos';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { isReadableScope } from '../../../../infrastructure/storage/accessScopeStore';
import type {
    PlannedWorkConfirmationName, PlannedWorkLooseWhenName, PlannedWorkPayModeName, PlannedWorkRow, PlannedWorkScopeName,
    PlannedWorkSourceKindName, PlannedWorkSourceName, PlannedWorkStatusName,
} from '../../../../infrastructure/storage/plannedWorkRow';

const STATUSES: readonly PlannedWorkStatusName[] = ['Open', 'Assigned', 'Seen', 'Accepted', 'Done', 'Cancelled'];
const SCOPES: readonly PlannedWorkScopeName[] = ['Plot', 'MultiPlot', 'Farm', 'Unspecified'];
const LOOSE: readonly PlannedWorkLooseWhenName[] = ['Week', 'Month', 'Anytime'];
const PAY: readonly PlannedWorkPayModeName[] = ['Cash', 'Daily', 'Contract', 'Later'];
const SOURCES: readonly PlannedWorkSourceName[] = ['Planning', 'VoiceLog', 'LogLeftover', 'Schedule'];
const KINDS: readonly PlannedWorkSourceKindName[] = ['Typed', 'PlanForm', 'Spoken', 'Leftover'];
const CONFIRMATIONS: readonly PlannedWorkConfirmationName[] = ['Confirmed', 'Disputed', 'Waiting'];

const known = <T extends string>(list: readonly T[], value: unknown): T | null =>
    typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);

/** The phone's row for a task the server sent, or null for a row it cannot read (it keeps its old copy and the next pull retries). */
export function plannedWorkRowFromDto(dto: PlannedWorkDto | null | undefined): PlannedWorkRow | null {
    if (!dto || typeof dto.id !== 'string' || !dto.id || typeof dto.farmId !== 'string' || !dto.farmId) return null;
    const status = known(STATUSES, dto.status);
    const scope = known(SCOPES, dto.scope);
    if (!status || !scope || typeof dto.title !== 'string' || typeof dto.modifiedAtUtc !== 'string' || !dto.modifiedAtUtc) return null;
    return {
        id: dto.id,
        farmId: dto.farmId,
        title: dto.title,
        scope,
        plannedDate: text(dto.plannedDate),
        looseWhen: known(LOOSE, dto.looseWhen),
        plannedTime: text(dto.plannedTime),
        assigneeUserId: text(dto.assigneeUserId),
        crewText: text(dto.crewText),
        expectedHeadcount: typeof dto.expectedHeadcount === 'number' ? dto.expectedHeadcount : null,
        quantityText: text(dto.quantityText),
        payMode: known(PAY, dto.payMode),
        note: text(dto.note),
        status,
        source: known(SOURCES, dto.source) ?? 'Planning',
        sourceKind: known(KINDS, dto.sourceKind),
        sourceDailyLogId: text(dto.sourceDailyLogId),
        sourceLogTaskId: text(dto.sourceLogTaskId),
        sourcePlotId: text(dto.sourcePlotId),
        recordedOn: typeof dto.recordedOn === 'string' ? dto.recordedOn : '',
        linkedDailyLogIds: ids(dto.linkedDailyLogIds),
        createdByUserId: typeof dto.createdByUserId === 'string' ? dto.createdByUserId : '',
        createdAtUtc: typeof dto.createdAtUtc === 'string' ? dto.createdAtUtc : dto.modifiedAtUtc,
        modifiedAtUtc: dto.modifiedAtUtc,
        seenAtUtc: text(dto.seenAtUtc),
        acceptedAtUtc: text(dto.acceptedAtUtc),
        doneAtUtc: text(dto.doneAtUtc),
        doneByUserId: text(dto.doneByUserId),
        cancelledAtUtc: text(dto.cancelledAtUtc),
        cancelledByUserId: text(dto.cancelledByUserId),
        cancelReason: text(dto.cancelReason),
        plots: (Array.isArray(dto.plots) ? dto.plots : [])
            .filter(p => p && typeof p.plotId === 'string' && p.plotId)
            .map(p => ({
                plotId: p.plotId,
                status: p.status === 'Done' ? 'Done' as const : 'Pending' as const,
                doneAtUtc: text(p.doneAtUtc),
                doneByUserId: text(p.doneByUserId),
                linkedDailyLogIds: ids(p.linkedDailyLogIds),
                confirmationState: known(CONFIRMATIONS, p.confirmationState),
            })),
        // Lane L8c-3 (additive, P11): a word we do not know, or none, is no word.
        confirmationState: known(CONFIRMATIONS, dto.confirmationState),
    };
}

export interface PlannedWorkReconcileOptions {
    /** The pull was asked from the beginning (cursor '0'): its tasks are the whole list. */
    fullPull?: boolean;
    /** This phone's signed-in person; null / absent = unknown: the scope sweep (L001) removes nothing. */
    userId?: string | null;
    /** Tasks with a change still in the outbox (P10). Absent = read from the outbox here. */
    pendingPlannedWorkIds?: Set<string>;
}

type ScopeWithTasks = FarmAccessScopeDto & { seeAllTasks?: boolean | null };

const STEPS: readonly string[] = [
    SyncMutationName.PlannedworkCreate, SyncMutationName.PlannedworkEdit, SyncMutationName.PlannedworkSeen,
    SyncMutationName.PlannedworkAccept, SyncMutationName.PlannedworkCancel, SyncMutationName.PlannedworkComplete,
    SyncMutationName.PlannedworkReopen,
];
/** A queue row is finished (nothing owed to the server) once it was applied or the farmer discarded it. */
const FINISHED = new Set(['APPLIED', 'REJECTED_DROPPED']);

/** The tasks this phone still owes the server a change for - parked refusals included (they are the farmer's to decide). */
export async function readPendingPlannedWorkIds(db: AgriLogDatabase): Promise<Set<string>> {
    const rows = await db.mutationQueue.where('mutationType').anyOf(STEPS).toArray();
    const out = new Set<string>();
    for (const r of rows) {
        const id = (r.payload as { plannedWorkId?: unknown } | null)?.plannedWorkId;
        if (!FINISHED.has(r.status) && typeof id === 'string') out.add(id);
    }
    // Lane L8c-4 (P10): a spoken reminder mirrored on this phone from a log whose create has not been acknowledged yet is not the
    // server's to take away - the server cannot have made it until it has the log. Once the log is applied, the server's row replaces
    // the mirror (same id); if the server made none, a full pull removes the mirror then.
    const mirrors = (await db.plannedWork.toArray()).filter(r => r.mirror === true && typeof r.sourceDailyLogId === 'string');
    if (mirrors.length > 0) {
        const unsentLogs = new Set<string>();
        for (const r of await db.mutationQueue.where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray()) {
            const logId = (r.payload as { dailyLogId?: unknown } | null)?.dailyLogId;
            if (!FINISHED.has(r.status) && typeof logId === 'string') unsentLogs.add(logId);
        }
        for (const m of mirrors) if (m.sourceDailyLogId && unsentLogs.has(m.sourceDailyLogId)) out.add(m.id);
    }
    return out;
}

/**
 * Mirrors the server's `PlannedWorkVisibility.VisiblePlots` (Domain/Planning/PlannedWorkRules.cs) for one reader, from the scope
 * the server sent. The plot ids of the rows he may see, or null when he may not see the task. For REMOVAL only.
 *   creator: every live plot; otherwise he must be the assignee or hold SeeAllTasks; a seat on every plot then sees it all;
 *   a chosen-plots seat sees a plot task only with one of his plots and only those rows, a Farm / Unspecified task only as its
 *   assignee (the creator was answered first).
 */
export function visiblePlotIds(row: PlannedWorkRow, userId: string, scope: ScopeWithTasks): string[] | null {
    const live = row.plots.map(p => p.plotId);
    if (row.createdByUserId === userId) return live;
    const isAssignee = row.assigneeUserId === userId;
    if (!isAssignee && scope.seeAllTasks !== true) return null;
    if (scope.plotScope !== 'ChosenPlots') return live;
    const chosen = new Set(scope.plotIds ?? []);
    if (row.scope !== 'Plot' && row.scope !== 'MultiPlot') return isAssignee ? live : null;
    const mine = live.filter(id => chosen.has(id));
    return mine.length > 0 ? mine : null;
}

/** Must run inside the orchestrator's `db.transaction('rw', ...)` that lists `db.plannedWork`. Returns how many rows were kept. */
export async function reconcilePlannedWork(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    options: PlannedWorkReconcileOptions = {},
): Promise<number> {
    const fromServer = (payload.plannedWork ?? [])
        .map(plannedWorkRowFromDto)
        .filter((row): row is PlannedWorkRow => row !== null);
    if (fromServer.length > 0) {
        await db.plannedWork.bulkPut(fromServer);
    }

    const all = Array.isArray(payload.accessScopes) ? payload.accessScopes : [];
    const scopes = all.filter(isReadableScope);
    if (all.length === 0) return fromServer.length; // an older server: the phone does not guess
    // MU-3 fix 1 (F9): a farm leaves the phone only on the server's EXPLICIT word (Paused / Waiting / Removed), never because it
    // is absent from the list.
    const notReadable = new Set(all.filter(s => !isReadableScope(s)).map(s => s.farmId));
    const reads = new Set(scopes.map(s => s.farmId));
    const sent = new Set(fromServer.map(r => r.id));
    const pending = options.pendingPlannedWorkIds ?? await readPendingPlannedWorkIds(db);
    const gone: string[] = [];
    for (const row of await db.plannedWork.toArray()) {
        if (notReadable.has(row.farmId) && !reads.has(row.farmId)) gone.push(row.id);
        else if (reads.has(row.farmId) && options.fullPull === true && !sent.has(row.id) && !(row.mirror === true && pending.has(row.id))) gone.push(row.id);
    }
    if (gone.length > 0) await db.plannedWork.bulkDelete(gone);
    await sweepToCurrentScope(db, scopes as ScopeWithTasks[], options);
    return fromServer.length;
}

/** L001: on every readable farm whose scope names `seeAllTasks`, drop what he may no longer see and trim the plot rows. */
async function sweepToCurrentScope(db: AgriLogDatabase, scopes: ScopeWithTasks[], options: PlannedWorkReconcileOptions): Promise<void> {
    const userId = options.userId;
    if (!userId) return;
    const known = scopes.filter(s => typeof s.seeAllTasks === 'boolean');
    if (known.length === 0) return;
    const pending = options.pendingPlannedWorkIds ?? await readPendingPlannedWorkIds(db);
    const byFarm = new Map(known.map(s => [s.farmId, s]));
    const remove: string[] = [];
    const trimmed: PlannedWorkRow[] = [];
    for (const row of await db.plannedWork.toArray()) {
        const scope = byFarm.get(row.farmId);
        // Lane L8c-4 fix 1 (L001): a mirror is his own spoken reminder by definition (the phone made it from what HE just said), so the
        // scope rule never takes it: only the pull's row of the same id replaces it (the flag goes with it), or a full pull that finds
        // it stale (above). Otherwise a pull that started before the server committed the log made his own reminder flicker away.
        if (!scope || pending.has(row.id) || row.mirror === true) continue;
        const keep = visiblePlotIds(row, userId, scope);
        if (keep === null) remove.push(row.id);
        else if (keep.length !== row.plots.length) trimmed.push({ ...row, plots: row.plots.filter(p => keep.includes(p.plotId)) });
    }
    if (remove.length > 0) await db.plannedWork.bulkDelete(remove);
    if (trimmed.length > 0) await db.plannedWork.bulkPut(trimmed);
}
