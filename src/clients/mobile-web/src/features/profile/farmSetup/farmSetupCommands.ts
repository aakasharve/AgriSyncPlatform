/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P3; founder 27 Nov: "the phone is only a door") - the phone's doors to the
 * farm-setup changes on the server. OFFLINE FIRST: each change goes through the sync outbox as the contract's mutation, with a bare GUID id made on the
 * phone, and is never lost. The phone decides nothing the server decides (who may edit, what is stale): it sends, and shows the server's answer.
 *
 *   - BASE REVISION: the revision the phone last received for the item (0 for an item the server never had), read here from the cache - or, when a
 *     change of the item still waits, THAT change's base (a second change replaces the first, it is not written on top of it).
 *   - A second change of the same item while the first still waits REPLACES the waiting row's payload (`MutationQueue.replacePayload`), keeping its base
 *     revision: never two rows. While a change of the item is being SENT, nothing is saved: `FarmSetupChangeBusy` ("आधीचा बदल जात आहे — थोडं थांबा").
 *   - Removing an item whose first save never reached the server takes that save back (soft-drop, kept for audit): nothing goes up.
 *   - An optional detail that is not known is LEFT OUT of the payload, never null (the contract's Zod refuses null).
 *   - A number with more than two decimals is refused here (`FarmSetupNumberTooFine`): the server refuses it too, and the phone never rounds what he
 *     typed in silence. The forms keep at most two decimals as he types (`twoDecimalsInput`).
 *   - Every payload is asked of the contract's own Zod before it is queued (the queue does it): a payload the server would refuse by shape never leaves.
 */
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueItem } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName, type SyncMutationType } from '../../../infrastructure/sync/SyncMutationCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { hasAtMostTwoDecimals } from './numbers';
import type {
    FarmMachineOwnership, FarmMachineType, FarmMotorPowerSource, FarmSetupTimetable, FarmWaterSourceType, PlotWaterMethod,
} from '../../../domain/types/farmSetup.types';

/** A change of this item is on its way right now: nothing is saved until it has gone (the form says so). */
export class FarmSetupChangeBusy extends Error {
    readonly code = 'FarmSetupChangeBusy';
    constructor() { super('An earlier change of this item is being sent right now. Nothing was saved.'); }
}

/** A number he typed has more than two decimals: the server keeps two and refuses more; the phone never rounds it in silence. */
export class FarmSetupNumberTooFine extends Error {
    readonly code = 'FarmSetupNumberTooFine';
    constructor(readonly field: string) { super(`${field} has more than two decimals. Nothing was saved.`); }
}

export interface MotorInput {
    motorId: string;
    name: string;
    hp: number;
    phase: 1 | 3;
    powerSource: FarmMotorPowerSource;
    powerSourceName?: string | null;
    drip?: { pipeSize?: string | null; hasFilter: boolean; flowLitresPerHour?: number | null } | null;
}

export interface WaterSourceInput {
    farmId: string;
    waterSourceId: string;
    name: string;
    sourceType: FarmWaterSourceType;
    isAvailable: boolean;
    notes?: string | null;
    motors: readonly MotorInput[];
}

export interface MachineInput {
    farmId: string;
    machineId: string;
    name: string;
    machineType: FarmMachineType;
    ownership: FarmMachineOwnership;
    company?: string | null;
    model?: string | null;
    hp?: number | null;
    nozzleCount?: number | null;
    tankLitres?: number | null;
    detailLine?: string | null;
}

export interface PlotWaterInput {
    farmId: string;
    plotId: string;
    method: PlotWaterMethod;
    links: readonly { waterSourceId: string; motorId?: string | null }[];
}

export interface QueuedFarmSetupChange {
    /** The queue row that now holds the change (null when the change only took back a save that never left). */
    clientRequestId: string | null;
    /** A waiting change of the same item was replaced, not doubled. */
    replaced: boolean;
}

// ── the item each mutation is about ─────────────────────────────────────────────────────────────────────

interface Family { types: readonly SyncMutationType[]; key: string }
const SOURCE: Family = { types: [SyncMutationName.FarmsetupWaterSourceSave, SyncMutationName.FarmsetupWaterSourceRemove], key: 'waterSourceId' };
const MACHINE: Family = { types: [SyncMutationName.FarmsetupMachineSave, SyncMutationName.FarmsetupMachineRemove], key: 'machineId' };
const POWER: Family = { types: [SyncMutationName.FarmsetupPowerTimesSet], key: 'farmId' };
const PLOT: Family = { types: [SyncMutationName.FarmsetupPlotWaterSet], key: 'plotId' };

const WAITING = new Set(['PENDING', 'FAILED']);
const OPEN = new Set(['PENDING', 'FAILED', 'SENDING']);

type Payload = Record<string, unknown>;
const payloadOf = (row: MutationQueueItem): Payload => ((row.payload ?? {}) as Payload);

async function openRowsOf(family: Family, farmId: string, itemId: string): Promise<MutationQueueItem[]> {
    const rows = await getDatabase().mutationQueue.where('mutationType').anyOf([...family.types]).toArray();
    return rows
        .filter(r => OPEN.has(r.status) && payloadOf(r).farmId === farmId && payloadOf(r)[family.key] === itemId)
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** The revision the phone last received for the item (0 = the server never had it). */
async function cachedRevision(family: Family, farmId: string, itemId: string): Promise<number> {
    const db = getDatabase();
    if (family === SOURCE) return (await db.farmWaterSources.get(itemId))?.revision ?? 0;
    if (family === MACHINE) return (await db.farmMachines.get(itemId))?.revision ?? 0;
    if (family === PLOT) return (await db.plotWater.get(itemId))?.revision ?? 0;
    return (await db.farmPowerTimes.get(farmId))?.powerTimes?.revision ?? 0;
}

function checked(mutation: SyncMutationType, payload: Payload): void {
    const result = validatePayload(mutation, payload);
    if (!result.ok) {
        throw new Error(`Payload validation failed for ${mutation}: ${result.errors.map(e => `${e.path || '<root>'} ${e.message}`).join('; ')}`);
    }
}

function kick(): void {
    backgroundSyncWorker.triggerNow().catch((err: unknown) => console.error('[farmSetupCommands] sync run after queueing failed', err));
}

async function enqueue(mutation: SyncMutationType, itemId: string, payload: Payload): Promise<string> {
    const clientRequestId = `${mutation}:${itemId}:${idGenerator.generate()}`;
    return mutationQueue.enqueue(mutation, payload, { clientRequestId, clientCommandId: clientRequestId });
}

/** A save or a set: replaces a waiting change of the item (keeping its base), else queues a new one on the cached base. */
async function queueWrite(mutation: SyncMutationType, family: Family, farmId: string, itemId: string, body: Payload): Promise<QueuedFarmSetupChange> {
    const open = await openRowsOf(family, farmId, itemId);
    if (open.some(r => r.status === 'SENDING')) throw new FarmSetupChangeBusy();
    const waiting = open.filter(r => WAITING.has(r.status) && r.mutationType === mutation).pop();
    if (waiting) {
        const base = payloadOf(waiting).baseRevision;
        const payload = { ...body, baseRevision: typeof base === 'number' ? base : 0 };
        checked(mutation, payload);
        await mutationQueue.replacePayload(waiting.clientRequestId, payload);
        kick();
        return { clientRequestId: waiting.clientRequestId, replaced: true };
    }
    const payload = { ...body, baseRevision: await cachedRevision(family, farmId, itemId) };
    checked(mutation, payload);
    const clientRequestId = await enqueue(mutation, itemId, payload);
    kick();
    return { clientRequestId, replaced: false };
}

/** A removal: takes back a waiting first save (nothing goes up), or sends the removal on the base of the change it replaces. */
async function queueRemove(remove: SyncMutationType, save: SyncMutationType, family: Family, farmId: string, itemId: string): Promise<QueuedFarmSetupChange> {
    const open = await openRowsOf(family, farmId, itemId);
    if (open.some(r => r.status === 'SENDING')) throw new FarmSetupChangeBusy();
    const waitingRemove = open.find(r => r.mutationType === remove);
    if (waitingRemove) return { clientRequestId: waitingRemove.clientRequestId, replaced: true };
    const waitingSave = open.filter(r => r.mutationType === save).pop();
    let base = await cachedRevision(family, farmId, itemId);
    if (waitingSave?.id !== undefined) {
        const saveBase = payloadOf(waitingSave).baseRevision;
        await mutationQueue.markRejectedDropped(waitingSave.id);
        // its first save never reached the server: taking it back is the whole removal
        if (typeof saveBase !== 'number' || saveBase === 0) return { clientRequestId: null, replaced: true };
        base = saveBase;
    }
    if (base === 0) return { clientRequestId: null, replaced: false };
    const payload = { farmId, [family.key]: itemId, baseRevision: base };
    checked(remove, payload);
    const clientRequestId = await enqueue(remove, itemId, payload);
    kick();
    return { clientRequestId, replaced: false };
}

// ── the shape on the wire ───────────────────────────────────────────────────────────────────────────────


const text = (v: string | null | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
};

function number(field: string, v: number | null | undefined): number | undefined {
    if (v === null || v === undefined || Number.isNaN(v)) return undefined;
    if (!hasAtMostTwoDecimals(v)) throw new FarmSetupNumberTooFine(field);
    return v;
}

/** Only the keys that carry a value: an unknown detail is LEFT OUT. */
function known(entries: Record<string, unknown>): Payload {
    return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));
}

function motorPayload(m: MotorInput): Payload {
    const drip = m.drip ? known({ pipeSize: text(m.drip.pipeSize), hasFilter: m.drip.hasFilter, flowLitresPerHour: number('flowLitresPerHour', m.drip.flowLitresPerHour) }) : undefined;
    return known({
        motorId: m.motorId, name: m.name.trim(), hp: number('hp', m.hp), phase: m.phase, powerSource: m.powerSource,
        powerSourceName: text(m.powerSourceName), drip,
    });
}

// ── the doors ───────────────────────────────────────────────────────────────────────────────────────────

/** "स्रोत जतन करा": one source with its WHOLE motor list (a motor not in the list is removed on the server, its plot links too). */
export async function saveWaterSource(input: WaterSourceInput): Promise<QueuedFarmSetupChange> {
    const body = known({
        farmId: input.farmId, waterSourceId: input.waterSourceId, name: input.name.trim(), sourceType: input.sourceType,
        isAvailable: input.isAvailable, notes: text(input.notes), motors: input.motors.map(motorPayload),
    });
    return queueWrite(SyncMutationName.FarmsetupWaterSourceSave, SOURCE, input.farmId, input.waterSourceId, body);
}

export async function removeWaterSource(input: { farmId: string; waterSourceId: string }): Promise<QueuedFarmSetupChange> {
    return queueRemove(SyncMutationName.FarmsetupWaterSourceRemove, SyncMutationName.FarmsetupWaterSourceSave, SOURCE, input.farmId, input.waterSourceId);
}

/** "वीज कधी असते?": the farm's timetable, written whole. */
export async function setPowerTimes(input: { farmId: string; timetable: FarmSetupTimetable }): Promise<QueuedFarmSetupChange> {
    return queueWrite(SyncMutationName.FarmsetupPowerTimesSet, POWER, input.farmId, input.farmId, { farmId: input.farmId, timetable: input.timetable });
}

export async function saveMachine(input: MachineInput): Promise<QueuedFarmSetupChange> {
    const body = known({
        farmId: input.farmId, machineId: input.machineId, name: input.name.trim(), machineType: input.machineType, ownership: input.ownership,
        company: text(input.company), model: text(input.model), hp: number('hp', input.hp), nozzleCount: number('nozzleCount', input.nozzleCount),
        tankLitres: number('tankLitres', input.tankLitres), detailLine: text(input.detailLine),
    });
    return queueWrite(SyncMutationName.FarmsetupMachineSave, MACHINE, input.farmId, input.machineId, body);
}

export async function removeMachine(input: { farmId: string; machineId: string }): Promise<QueuedFarmSetupChange> {
    return queueRemove(SyncMutationName.FarmsetupMachineRemove, SyncMutationName.FarmsetupMachineSave, MACHINE, input.farmId, input.machineId);
}

/** "या प्लॉटला पाण्याची सोय कशी केली आहे?": the plot's method and its WHOLE link list (a canal by gravity: no motor). */
export async function setPlotWater(input: PlotWaterInput): Promise<QueuedFarmSetupChange> {
    const body = {
        farmId: input.farmId, plotId: input.plotId, method: input.method,
        links: input.links.map(l => known({ waterSourceId: l.waterSourceId, motorId: l.motorId ?? undefined })),
    };
    return queueWrite(SyncMutationName.FarmsetupPlotWaterSet, PLOT, input.farmId, input.plotId, body);
}

export { hasAtMostTwoDecimals, twoDecimalsInput } from './numbers';

/**
 * "माझा बदल पुन्हा करा" / "नवीन माहिती पहा": a refused change (parked) is closed by him - soft-dropped (kept for audit). The form then opens with his
 * typed values on top of the NEW version; its save is an ordinary change on the new base.
 */
export async function closeRefusedChange(rowId: number): Promise<void> {
    await mutationQueue.markRejectedDropped(rowId);
}
