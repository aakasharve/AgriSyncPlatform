/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c, D-26, D-79) - the ONE local read of the farm's
 * tasks and reminders, both halves labelled (the shape of `features/labour/data/attendanceLocal.ts`).
 *
 * `source: 'server'` rows came down /sync/pull - acknowledged, reconstructable without this device (P10) - and are exactly what
 * the server let THIS person see. `source: 'queue'` rows are live mutation-queue intent that has not been answered yet; a
 * change queued over a server row keeps `source: 'server'` and sets `keptOnPhone`, because the server row is still the truth.
 * Every consumer that shows `keptOnPhone` must say "फोनवर ठेवलं" (`plannedWorkWords`) until the server has acknowledged it:
 * a queued fact is never drawn as saved.
 *
 * Another farm's items are never returned (`getLocalPlannedWork(farmId)` keeps them out, queue and server alike).
 * A refused change (a parked rejection) is NOT intent: it sits on the conflict page with its words, and the server row (if any) stays
 * as it is. One exception (lane L8c-2 fix round 1, P003; P10): a task whose CREATE the server refused would otherwise vanish from the
 * plan list, so it is returned as an item marked `refused` - never done, no step waiting, not open work - for the card to say its refusal
 * words and open the conflict page. It follows the outbox row: discarded (`REJECTED_DROPPED`) it is gone; re-sent it is a normal queued
 * task again; if the server has the task by then, the server's row wins.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type {
    PlannedWorkLooseWhenName, PlannedWorkPayModeName, PlannedWorkRow, PlannedWorkScopeName, PlannedWorkSourceKindName,
    PlannedWorkStatusName,
} from '../../../infrastructure/storage/plannedWorkRow';
import type { PlannedWorkVerb } from './plannedWorkCommands';

/** The queue statuses that ARE live local intent: waiting, being sent, or retry-capped but still his statement. */
const LIVE_INTENT_STATUSES: ReadonlySet<MutationQueueStatus> = new Set<MutationQueueStatus>(['PENDING', 'SENDING', 'FAILED']);

/** A change the server refused and parked on the conflict page. */
const PARKED: MutationQueueStatus = 'REJECTED_USER_REVIEW';

export interface LocalPlannedWork {
    id: string;
    farmId: string;
    title: string;
    scope: PlannedWorkScopeName;
    plotIds: string[];
    plannedDate: string | null;
    looseWhen: PlannedWorkLooseWhenName | null;
    plannedTime: string | null;
    assigneeUserId: string | null;
    crewText: string | null;
    expectedHeadcount: number | null;
    quantityText: string | null;
    payMode: PlannedWorkPayModeName | null;
    note: string | null;
    status: PlannedWorkStatusName;
    sourceKind: PlannedWorkSourceKindName | null;
    recordedOn: string;
    createdByUserId: string | null;
    modifiedAtUtc: string | null;
    /** `server` = a row the server sent. `queue` = made on this phone, not yet acknowledged. */
    source: 'server' | 'queue';
    /** True while a change of this item waits for the server ("फोनवर ठेवलं"). Always true for `source: 'queue'`. */
    keptOnPhone: boolean;
    /** The queued changes waiting on it, oldest first. */
    pendingSteps: PlannedWorkVerb[];
    /** The server refused the create and it is parked on the conflict page: shown with its refusal, never as done or as open work. */
    refused: boolean;
}

interface QueuedPlannedWork {
    verb: PlannedWorkVerb;
    payload: Record<string, unknown>;
    createdAt: string;
}

const VERB_OF: Readonly<Record<string, PlannedWorkVerb>> = {
    [SyncMutationName.PlannedworkCreate]: 'create',
    [SyncMutationName.PlannedworkEdit]: 'edit',
    [SyncMutationName.PlannedworkSeen]: 'seen',
    [SyncMutationName.PlannedworkAccept]: 'accept',
    [SyncMutationName.PlannedworkCancel]: 'cancel',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function fromServer(row: PlannedWorkRow): LocalPlannedWork {
    return {
        id: row.id,
        farmId: row.farmId,
        title: row.title,
        scope: row.scope,
        plotIds: row.plots.map(p => p.plotId),
        plannedDate: row.plannedDate,
        looseWhen: row.looseWhen,
        plannedTime: row.plannedTime,
        assigneeUserId: row.assigneeUserId,
        crewText: row.crewText,
        expectedHeadcount: row.expectedHeadcount,
        quantityText: row.quantityText,
        payMode: row.payMode,
        note: row.note,
        status: row.status,
        sourceKind: row.sourceKind,
        recordedOn: row.recordedOn,
        createdByUserId: row.createdByUserId || null,
        modifiedAtUtc: row.modifiedAtUtc,
        source: 'server',
        keptOnPhone: false,
        pendingSteps: [],
        refused: false,
    };
}

/** The words a queued create / edit carries, laid over an item. */
function withWords(item: LocalPlannedWork, p: Record<string, unknown>): LocalPlannedWork {
    return {
        ...item,
        title: str(p.title) ?? item.title,
        scope: (str(p.scope) as PlannedWorkScopeName | null) ?? item.scope,
        plotIds: Array.isArray(p.plotIds) ? p.plotIds.filter((x): x is string => typeof x === 'string') : [],
        plannedDate: str(p.plannedDate),
        looseWhen: str(p.looseWhen) as PlannedWorkLooseWhenName | null,
        plannedTime: str(p.plannedTime),
        assigneeUserId: str(p.assigneeUserId),
        crewText: str(p.crewText),
        expectedHeadcount: typeof p.expectedHeadcount === 'number' ? p.expectedHeadcount : null,
        quantityText: str(p.quantityText),
        payMode: str(p.payMode) as PlannedWorkPayModeName | null,
        note: str(p.note),
    };
}

function overlay(item: LocalPlannedWork, step: QueuedPlannedWork): LocalPlannedWork {
    let next: LocalPlannedWork = { ...item, keptOnPhone: true, pendingSteps: [...item.pendingSteps, step.verb] };
    if (step.verb === 'edit') {
        next = withWords(next, step.payload);
        // A new person means the answers start again (the server's rule); the phone shows the same.
        const assignee = str(step.payload.assigneeUserId);
        if (assignee !== item.assigneeUserId) next.status = assignee ? 'Assigned' : 'Open';
    } else if (step.verb === 'seen') {
        if (next.status === 'Assigned') next.status = 'Seen';
    } else if (step.verb === 'accept') {
        if (next.status === 'Assigned' || next.status === 'Seen') next.status = 'Accepted';
    } else if (step.verb === 'cancel') {
        if (next.status !== 'Done') next.status = 'Cancelled';
    }
    return next;
}

/**
 * The farm's tasks and reminders as this phone knows them: the server's rows with this phone's unanswered changes laid over
 * them, and the tasks made here that the server has not acknowledged yet. Only `farmId`'s items are returned.
 */
export async function getLocalPlannedWork(farmId: string): Promise<LocalPlannedWork[]> {
    const db = getDatabase();
    const server = await db.plannedWork.where('farmId').equals(farmId).toArray();
    const queueRows = await db.mutationQueue
        .where('mutationType').anyOf(Object.keys(VERB_OF))
        .filter(row => LIVE_INTENT_STATUSES.has(row.status) || (row.status === PARKED && row.mutationType === SyncMutationName.PlannedworkCreate))
        .toArray();

    const items = new Map<string, LocalPlannedWork>(server.map(row => [row.id, fromServer(row)]));
    const steps = queueRows
        .map(row => ({ row, verb: VERB_OF[row.mutationType], payload: (row.payload ?? {}) as Record<string, unknown> }))
        .filter(x => x.verb !== undefined && str(x.payload.plannedWorkId) !== null && x.payload.farmId === farmId)
        .sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt) || (a.row.id ?? 0) - (b.row.id ?? 0)); // L002: then the outbox's own order

    for (const { row, verb, payload } of steps) {
        const id = str(payload.plannedWorkId)!;
        const step: QueuedPlannedWork = { verb, payload, createdAt: row.createdAt };
        const existing = items.get(id);
        if (existing?.refused) continue; // nothing is laid over a refused create: it has not happened
        if (verb === 'create') {
            if (existing) continue; // the server has it: the create is acknowledged in all but name
            const made = withWords({
                id,
                farmId,
                title: '',
                scope: 'Unspecified',
                plotIds: [],
                plannedDate: null,
                looseWhen: null,
                plannedTime: null,
                assigneeUserId: null,
                crewText: null,
                expectedHeadcount: null,
                quantityText: null,
                payMode: null,
                note: null,
                status: str(payload.assigneeUserId) ? 'Assigned' : 'Open',
                sourceKind: (str(payload.sourceKind) as PlannedWorkSourceKindName | null) ?? 'PlanForm',
                recordedOn: str(payload.recordedOn) ?? '',
                createdByUserId: null,
                modifiedAtUtc: null,
                source: 'queue',
                keptOnPhone: row.status !== PARKED,
                pendingSteps: row.status === PARKED ? [] : ['create'],
                refused: row.status === PARKED,
            }, payload);
            items.set(id, made);
        } else if (existing) {
            items.set(id, overlay(existing, step));
        }
    }

    return [...items.values()].filter(item => item.farmId === farmId);
}
