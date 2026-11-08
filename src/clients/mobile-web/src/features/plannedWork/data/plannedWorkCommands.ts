/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, founder D-24c, D-24a, D-26) - the phone's five doors to the
 * task record: make, change, seen, accept, cancel. Each is a queued mutation (it works with no internet; the server decides
 * when it arrives: P10). The outbox key of each is `plannedwork.<verb>:<id>`, so a tap made twice is ONE queued change.
 *
 * What a re-tap does (the ONE place that says so):
 *   - create / seen:  queued once. `seen` is a fact about a moment - never revived once refused or discarded.
 *   - accept / cancel: a re-tap after he DISCARDED the parked refusal (`REJECTED_DROPPED`) revives that same row through
 *     `replacePayload` (the same bytes, back to PENDING), so the farmer is never stuck with a change he can no longer make again.
 *   - edit: the latest edit of an unsent one replaces it (`replacePayload`); once an edit was SENT, the next edit is a new
 *     queued change under the next key (`plannedwork.edit:<id>:<n>`), because the server stores only applied request ids.
 *
 * Only words travel (D-24a, P4): a headcount, a quantity and a pay choice are fields of text and numbers the farmer typed; this
 * file never turns them into anything else, and has no import of attendance, labour or cost code.
 * Who made it, when, and its status are the server's: there is no field for them.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type {
    PlannedWorkLooseWhenName, PlannedWorkPayModeName, PlannedWorkScopeName, PlannedWorkSourceKindName,
} from '../../../infrastructure/storage/plannedWorkRow';

/** The words of a task (the wire twin of `plannedwork_create.zod.ts`, without the ids). */
export interface PlannedWorkWordsInput {
    title: string;
    scope: PlannedWorkScopeName;
    /** One plot for `Plot`, two or more for `MultiPlot`, none for `Farm` / `Unspecified`. */
    plotIds?: string[];
    /** YYYY-MM-DD. Optional: an undated task is never late. Never together with `looseWhen`. */
    plannedDate?: string;
    looseWhen?: PlannedWorkLooseWhenName;
    /** HH:mm, only with a date. */
    plannedTime?: string;
    /** Absent (or himself) = a personal reminder. Another person needs "assign work" on the farm. */
    assigneeUserId?: string;
    crewText?: string;
    expectedHeadcount?: number;
    quantityText?: string;
    payMode?: PlannedWorkPayModeName;
    note?: string;
}

export interface CreatePlannedWorkInput extends PlannedWorkWordsInput {
    plannedWorkId: string;
    farmId: string;
    sourceKind?: Exclude<PlannedWorkSourceKindName, 'Leftover'>;
    /** YYYY-MM-DD: the farm-local day it was made (D-29). Absent = the server's farm-local day. */
    recordedOn?: string;
}

export interface EditPlannedWorkInput extends PlannedWorkWordsInput {
    plannedWorkId: string;
    farmId: string;
}

export type PlannedWorkVerb = 'create' | 'edit' | 'seen' | 'accept' | 'cancel';

const MUTATION = {
    create: SyncMutationName.PlannedworkCreate,
    edit: SyncMutationName.PlannedworkEdit,
    seen: SyncMutationName.PlannedworkSeen,
    accept: SyncMutationName.PlannedworkAccept,
    cancel: SyncMutationName.PlannedworkCancel,
} as const;

/** Drops the fields that were not given: the wire is strict, and "absent" is the only way to say "none". */
function present<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== '')) as T;
}

export class PlannedWorkCommands {
    /** `plannedwork.<verb>:<id>` - the outbox key. */
    static requestIdFor(verb: PlannedWorkVerb, plannedWorkId: string): string {
        return `plannedwork.${verb}:${plannedWorkId}`;
    }

    static async create(input: CreatePlannedWorkInput): Promise<string> {
        const clientRequestId = PlannedWorkCommands.requestIdFor('create', input.plannedWorkId);
        return mutationQueue.enqueue(MUTATION.create, present(input), { clientRequestId, clientCommandId: clientRequestId });
    }

    /** The latest unsent edit wins; an edit already sent is followed by a new one. */
    static async edit(input: EditPlannedWorkInput): Promise<string> {
        const base = PlannedWorkCommands.requestIdFor('edit', input.plannedWorkId);
        const payload = present(input);
        const db = getDatabase();
        const deviceId = mutationQueue.getDeviceId();
        const rows = await db.mutationQueue.where('mutationType').equals(MUTATION.edit)
            .filter(row => row.clientRequestId === base || row.clientRequestId.startsWith(`${base}:`))
            .toArray();
        const unsent = rows.find(row => row.deviceId === deviceId && (row.status === 'PENDING' || row.status === 'FAILED'));
        if (unsent) {
            await mutationQueue.replacePayload(unsent.clientRequestId, payload);
            return unsent.clientRequestId;
        }
        const clientRequestId = rows.length === 0 ? base : `${base}:${rows.length + 1}`;
        return mutationQueue.enqueue(MUTATION.edit, payload, { clientRequestId, clientCommandId: clientRequestId });
    }

    /** The assignee has seen it. Queued once; never revived. */
    static async seen(plannedWorkId: string, farmId: string): Promise<string> {
        const clientRequestId = PlannedWorkCommands.requestIdFor('seen', plannedWorkId);
        return mutationQueue.enqueue(MUTATION.seen, { plannedWorkId, farmId }, { clientRequestId, clientCommandId: clientRequestId });
    }

    /** The assignee accepts it. A re-tap after he discarded the parked refusal revives that row. */
    static async accept(plannedWorkId: string, farmId: string): Promise<string> {
        return PlannedWorkCommands.answer('accept', { plannedWorkId, farmId });
    }

    /** Stop the work. A re-tap after he discarded the parked refusal revives that row. */
    static async cancel(plannedWorkId: string, farmId: string, reason?: string): Promise<string> {
        return PlannedWorkCommands.answer('cancel', present({ plannedWorkId, farmId, reason }));
    }

    private static async answer(verb: 'accept' | 'cancel', payload: Record<string, unknown>): Promise<string> {
        const clientRequestId = PlannedWorkCommands.requestIdFor(verb, String(payload.plannedWorkId));
        const db = getDatabase();
        const existing = await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), clientRequestId])
            .first();
        if (existing?.status === 'REJECTED_DROPPED') {
            await mutationQueue.replacePayload(clientRequestId, payload);
            return clientRequestId;
        }
        return mutationQueue.enqueue(MUTATION[verb], payload, { clientRequestId, clientCommandId: clientRequestId });
    }
}
