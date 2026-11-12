/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 3; founder D-132, D-83 = 1, doctrine P9, P10) - the phone's doors to the server's
 * own-schedule mutations. OFFLINE-FIRST: create, clone and edit go through the existing sync outbox as the contract's mutations
 * (`schedule.create`, `schedule.clone`, `schedule.edit`, contract 1.14.0) with client-minted ids and a clientCommandId, like every other mutation.
 * No REST from the maker. The queue checks each payload against the contract's own Zod schema BEFORE it is queued, so a payload the server would
 * refuse by shape never leaves the phone (it throws here instead).
 *
 *   - blank start      -> `schedule.create` (the empty schedule; the tags ride on it) and, when stages were given, ONE `schedule.edit` that writes the
 *                         stages and works whole as the next version (the contract has no "create with stages");
 *   - checked start    -> `schedule.clone` INTO the farm's own (`intoFarmOwn`, Team scope: stores the source's days, no check - D-82 = 3) and, only when
 *                         he changed the name, the tags or the works, ONE `schedule.edit` of that copy;
 *   - a later change   -> ONE `schedule.edit`: the next version written WHOLE (never in place; the version before is kept - P3).
 * Who made it, when, its version and its OWNER are the server's: the actor is the authenticated person and the owner is the farm's owner (Q9 = 1).
 * The phone decides nothing the server decides (who may make, which crop, ids unique): it sends, and shows the server's refusal in words
 * (`RejectionPolicy`, `ownScheduleWords`).
 */
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getAuthSession } from '../../../infrastructure/storage/AuthTokenStore';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { MADE_FOR_KEYS, type MadeForTags, type OwnStage, type OwnWork } from './ownScheduleModel';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_GUID = '00000000-0000-4000-8000-000000000000';
const OPERATION_KEY = /^op_[a-z0-9_]+$/;

interface Common {
    farmId: string;
    /** The made-for tags (absent = none). */
    madeFor: MadeForTags;
    stages: readonly OwnStage[];
    works: readonly OwnWork[];
}

export type SaveOwnScheduleInput =
    | (Common & { mode: 'blank'; cropKey: string; name: string })
    | (Common & { mode: 'checked'; sourceScheduleTemplateId: string; /** Null = keep the copy's own name. */ name: string | null; /** Anything beyond the plain copy (name, tags, stages, works). */ changed: boolean })
    | (Common & {
        mode: 'edit';
        /** The version he is changing. */
        scheduleTemplateId: string;
        /** Null = keep the name. */
        name: string | null;
        /**
         * Every version of this schedule the pulled rows hold. With it the guard also catches a change the server ACCEPTED whose new version the phone has
         * not pulled yet (the pulled rows still end at the version before it). Absent = only the saves still on this phone count.
         */
        knownVersionIds?: readonly string[];
    });

/**
 * spec: plr-d10 lane SCH-OWN-b fix round 1 (P001; P3) - a change is always written on top of the NEWEST version he has made. The phone's rows only show
 * what the server has sent, so a second change made before the first one synced would name the same version and the server would keep two children of
 * it; the one made last wins and the first silently disappears. So while a save of that schedule is still his unsynced change - queued, sending, failed
 * (stuck at the cap included) or held - a further change is REFUSED, in words, and nothing is written. A save the server REFUSED (parked) does not block:
 * the next change may start again from the same version.
 */
export class OwnScheduleChangeBlocked extends Error {
    readonly code = 'OwnScheduleChangeBlocked';
    constructor() {
        super('An earlier change of this schedule has not reached the server yet.');
    }
}

const WRITE_TYPES: readonly string[] = [SyncMutationName.ScheduleCreate, SyncMutationName.ScheduleClone, SyncMutationName.ScheduleEdit];
const UNSYNCED: ReadonlySet<string> = new Set(['PENDING', 'SENDING', 'FAILED']);

/** The queued saves that make a change on `sourceId` unsafe right now (none = free). Reads only the few own-schedule rows, never the whole outbox. */
export async function findBlockingSaves(sourceId: string, knownVersionIds?: readonly string[]): Promise<string[]> {
    const rows = await getDatabase().mutationQueue.where('mutationType').anyOf(WRITE_TYPES).toArray();
    const known = knownVersionIds ? new Set(knownVersionIds) : null;
    return rows.filter(row => {
        const p = (row.payload ?? {}) as Record<string, unknown>;
        const touches = p.scheduleTemplateId === sourceId || p.newScheduleTemplateId === sourceId;
        if (UNSYNCED.has(row.status)) return touches;
        // The server accepted it, but the pulled rows do not hold what it made yet: a change now would name the version before it.
        return row.status === 'APPLIED' && known !== null && row.mutationType === SyncMutationName.ScheduleEdit
            && typeof p.scheduleTemplateId === 'string' && known.has(p.scheduleTemplateId)
            && typeof p.newScheduleTemplateId === 'string' && !known.has(p.newScheduleTemplateId);
    }).map(row => row.clientRequestId);
}

export interface SaveOwnScheduleResult {
    /** The first row THIS call made: the created / cloned schedule, or - for an edit - the next version. */
    scheduleTemplateId: string;
    /** The last row it made (the schedule's newest version once the server has answered). */
    latestScheduleTemplateId: string;
    /** How many mutations were queued. */
    queued: number;
    clientRequestIds: string[];
}

const tagsOf = (madeFor: MadeForTags): MadeForTags => {
    const out: MadeForTags = {};
    for (const key of MADE_FOR_KEYS) {
        const value = madeFor[key]?.trim();
        if (value) out[key] = value;
    }
    return out;
};

const activityOf = (w: OwnWork) => ({
    name: w.name.trim(),
    part: w.part,
    ...(w.operationKey && w.operationKey.length <= 40 && OPERATION_KEY.test(w.operationKey) ? { operationKey: w.operationKey } : {}),
    startDay: w.startDay,
    endDay: w.endDay,
    frequencyMode: w.mode,
    intervalDays: w.mode === 'one_time' ? 1 : w.intervalDays,
});

function actorUserId(): string {
    const user = getAuthSession()?.userId;
    return user && GUID_RE.test(user) ? user : NIL_GUID;
}

type ScheduleMutation = typeof SyncMutationName.ScheduleCreate | typeof SyncMutationName.ScheduleClone | typeof SyncMutationName.ScheduleEdit;

async function queue(mutation: ScheduleMutation, newId: string, payload: Record<string, unknown>): Promise<string> {
    const verb = mutation === SyncMutationName.ScheduleCreate ? 'create' : mutation === SyncMutationName.ScheduleClone ? 'clone' : 'edit';
    const clientRequestId = `schedule.${verb}:${newId}`;
    return mutationQueue.enqueue(mutation, payload, { clientRequestId, clientCommandId: clientRequestId });
}

/** The next version written whole: the stages and works as they stand now. */
function wholeEdit(sourceId: string, newId: string, input: Common, name: string | null | undefined): Record<string, unknown> {
    const clientCommandId = `schedule.edit:${newId}`;
    return {
        scheduleTemplateId: sourceId,
        newScheduleTemplateId: newId,
        actorUserId: actorUserId(),
        clientCommandId,
        farmId: input.farmId,
        ...(name && name.trim() ? { newName: name.trim() } : {}),
        stages: input.stages.map(s => ({ name: s.name.trim(), startDay: s.startDay, endDay: s.endDay })),
        ...(input.works.length > 0 ? { activities: input.works.map(activityOf) } : {}),
        ...tagsOf(input.madeFor),
    };
}

interface Planned { mutation: ScheduleMutation; newId: string; payload: Record<string, unknown> }

/** The mutations one save needs, in order, with their payloads - nothing is queued yet. */
function plan(input: SaveOwnScheduleInput): { steps: Planned[]; first: string; latest: string } {
    const steps: Planned[] = [];
    if (input.mode === 'blank') {
        const created = idGenerator.generate();
        steps.push({
            mutation: SyncMutationName.ScheduleCreate, newId: created,
            payload: { scheduleTemplateId: created, farmId: input.farmId, cropKey: input.cropKey, name: input.name.trim(), ...tagsOf(input.madeFor) },
        });
        let latest = created;
        if (input.stages.length > 0) {
            latest = idGenerator.generate();
            steps.push({ mutation: SyncMutationName.ScheduleEdit, newId: latest, payload: wholeEdit(created, latest, input, null) });
        }
        return { steps, first: created, latest };
    }
    if (input.mode === 'checked') {
        const copy = idGenerator.generate();
        steps.push({
            mutation: SyncMutationName.ScheduleClone, newId: copy,
            payload: {
                sourceScheduleTemplateId: input.sourceScheduleTemplateId, newScheduleTemplateId: copy, actorUserId: actorUserId(),
                clientCommandId: `schedule.clone:${copy}`, newScope: 'Team', farmId: input.farmId, intoFarmOwn: true,
            },
        });
        let latest = copy;
        if (input.changed && input.stages.length > 0) {
            latest = idGenerator.generate();
            steps.push({ mutation: SyncMutationName.ScheduleEdit, newId: latest, payload: wholeEdit(copy, latest, input, input.name) });
        }
        return { steps, first: copy, latest };
    }
    if (input.stages.length === 0) throw new Error('A schedule version needs at least one stage.');
    const next = idGenerator.generate();
    steps.push({ mutation: SyncMutationName.ScheduleEdit, newId: next, payload: wholeEdit(input.scheduleTemplateId, next, input, input.name) });
    return { steps, first: next, latest: next };
}

export async function saveOwnSchedule(input: SaveOwnScheduleInput): Promise<SaveOwnScheduleResult> {
    if (input.mode === 'edit' && (await findBlockingSaves(input.scheduleTemplateId, input.knownVersionIds)).length > 0) {
        throw new OwnScheduleChangeBlocked();
    }
    const { steps, first, latest } = plan(input);
    // Every payload is asked of the contract BEFORE the first one is queued, so a save never half-happens (a created schedule whose edit was refused by shape).
    for (const step of steps) {
        const checked = validatePayload(step.mutation, step.payload);
        if (!checked.ok) {
            throw new Error(`Payload validation failed for ${step.mutation}: ${checked.errors.map(e => `${e.path || '<root>'} ${e.message}`).join('; ')}`);
        }
    }
    const requests: string[] = [];
    for (const step of steps) requests.push(await queue(step.mutation, step.newId, step.payload));
    backgroundSyncWorker.triggerNow().catch((err: unknown) => {
        console.error('[saveOwnSchedule] sync run after queueing the schedule failed', err);
    });
    return { scheduleTemplateId: first, latestScheduleTemplateId: latest, queued: requests.length, clientRequestIds: requests };
}
