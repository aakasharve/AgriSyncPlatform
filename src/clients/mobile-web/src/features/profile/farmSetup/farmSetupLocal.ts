/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P3; P10) - ONE farm's setup AS THIS PHONE KNOWS IT: the server's rows (the v33
 * stores, the truth) with this phone's unanswered changes of that farm laid over them in the order they were made. Each item is marked:
 *   - `saved`   - it is the server's (on every phone of the farm): no line;
 *   - `waiting` - a change of it has not reached the server yet ("अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.");
 *   - `refused` - the server refused a change of it (parked): the SERVER's item is shown, with the refusal and what he typed beside it, until he acts.
 * A waiting removal hides the item and is counted in `waitingCount`. Queued intent is never drawn as saved; a refused change is never drawn as saved.
 * The pattern of `getLocalOwnSchedule` (features/scheduler/ownSchedule/ownScheduleLocal.ts).
 */
import type { AgriLogDatabase, MutationQueueItem, MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../infrastructure/storage/DexieFarmSetupRepository';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { refusalKindOf, type FarmSetupRefusalKind } from './refusalKind';
import type {
    FarmSetupMachine, FarmSetupMotor, FarmSetupPowerTimes, FarmSetupTimetable, FarmSetupWaterSource, PlotWaterSetup,
} from '../../../domain/types/farmSetup.types';

export type FarmSetupItemState = 'saved' | 'waiting' | 'refused';
export { refusalKindOf, type FarmSetupRefusalKind } from './refusalKind';

export interface FarmSetupRefusal {
    rowId: number;
    clientRequestId: string;
    mutationType: string;
    errorCode: string | null;
    kind: FarmSetupRefusalKind;
    /** What he sent, exactly: the form re-opens with it ("माझा बदल पुन्हा करा"). */
    payload: Record<string, unknown>;
}

export interface LocalItem<T> {
    item: T;
    state: FarmSetupItemState;
    refusal: FarmSetupRefusal | null;
}

export interface LocalFarmSetup {
    farmId: string;
    /** The server has sent this farm's set (false: an old server, or no pull asked yet - the screens keep the phone-only setup then). */
    received: boolean;
    waterSources: LocalItem<FarmSetupWaterSource>[];
    machines: LocalItem<FarmSetupMachine>[];
    powerTimes: LocalItem<FarmSetupPowerTimes> | null;
    plotWater: ReadonlyMap<string, LocalItem<PlotWaterSetup>>;
    /** Changes of this farm that have not reached the server (removals included). */
    waitingCount: number;
    /** Every parked change of this farm, oldest first. */
    refused: FarmSetupRefusal[];
}

const WAITING: ReadonlySet<MutationQueueStatus> = new Set<MutationQueueStatus>(['PENDING', 'SENDING', 'FAILED']);
const PARKED: MutationQueueStatus = 'REJECTED_USER_REVIEW';
const TYPES = [
    SyncMutationName.FarmsetupWaterSourceSave, SyncMutationName.FarmsetupWaterSourceRemove, SyncMutationName.FarmsetupPowerTimesSet,
    SyncMutationName.FarmsetupMachineSave, SyncMutationName.FarmsetupMachineRemove, SyncMutationName.FarmsetupPlotWaterSet,
];

type P = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function motorOf(m: P): FarmSetupMotor {
    const drip = m.drip && typeof m.drip === 'object' ? m.drip as P : null;
    return {
        id: String(m.motorId), name: String(m.name), hp: Number(m.hp), phase: m.phase === 1 ? 1 : 3, powerSource: m.powerSource as FarmSetupMotor['powerSource'],
        powerSourceName: str(m.powerSourceName),
        drip: drip ? { pipeSize: str(drip.pipeSize), hasFilter: drip.hasFilter === true, flowLitresPerHour: num(drip.flowLitresPerHour) } : null,
    };
}

/** A queued `water_source.save` payload as the item it will become (on the revision the server holds now). */
export function waterSourceFromPayload(p: P, revision: number, at: string): FarmSetupWaterSource {
    return {
        id: String(p.waterSourceId), farmId: String(p.farmId), revision, name: String(p.name), sourceType: p.sourceType as FarmSetupWaterSource['sourceType'],
        isAvailable: p.isAvailable !== false, notes: str(p.notes), motors: Array.isArray(p.motors) ? (p.motors as P[]).map(motorOf) : [], updatedAtUtc: at,
    };
}

export function machineFromPayload(p: P, revision: number, at: string): FarmSetupMachine {
    return {
        id: String(p.machineId), farmId: String(p.farmId), revision, name: String(p.name), machineType: p.machineType as FarmSetupMachine['machineType'],
        ownership: p.ownership === 'rented' ? 'rented' : 'owned', company: str(p.company), model: str(p.model), hp: num(p.hp), nozzleCount: num(p.nozzleCount),
        tankLitres: num(p.tankLitres), detailLine: str(p.detailLine), updatedAtUtc: at,
    };
}

export function plotWaterFromPayload(p: P, revision: number, at: string): PlotWaterSetup {
    return {
        plotId: String(p.plotId), farmId: String(p.farmId), revision, method: p.method as PlotWaterSetup['method'],
        links: Array.isArray(p.links) ? (p.links as P[]).map(l => ({ waterSourceId: String(l.waterSourceId), motorId: str(l.motorId) })) : [], updatedAtUtc: at,
    };
}

const byName = <T extends { name: string; id: string }>(a: LocalItem<T>, b: LocalItem<T>) =>
    a.item.name.localeCompare(b.item.name) || a.item.id.localeCompare(b.item.id);

export async function getLocalFarmSetup(db: AgriLogDatabase, farmId: string): Promise<LocalFarmSetup> {
    const set = await new DexieFarmSetupRepository(db).read(farmId);
    const sources = new Map<string, LocalItem<FarmSetupWaterSource>>((set?.waterSources ?? []).map(s => [s.id, { item: s, state: 'saved', refusal: null }]));
    const machines = new Map<string, LocalItem<FarmSetupMachine>>((set?.machines ?? []).map(m => [m.id, { item: m, state: 'saved', refusal: null }]));
    const plots = new Map<string, LocalItem<PlotWaterSetup>>((set?.plotWater ?? []).map(p => [p.plotId, { item: p, state: 'saved', refusal: null }]));
    let power: LocalItem<FarmSetupPowerTimes> | null = set?.powerTimes ? { item: set.powerTimes, state: 'saved', refusal: null } : null;
    const serverRevision = { source: new Map((set?.waterSources ?? []).map(s => [s.id, s.revision])), machine: new Map((set?.machines ?? []).map(m => [m.id, m.revision])) };

    const rows: MutationQueueItem[] = (await db.mutationQueue.where('mutationType').anyOf(TYPES).toArray())
        .filter(r => (WAITING.has(r.status) || r.status === PARKED) && (r.payload as P | null)?.farmId === farmId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id ?? 0) - (b.id ?? 0));

    let waitingCount = 0;
    const refused: FarmSetupRefusal[] = [];
    for (const row of rows) {
        const p = (row.payload ?? {}) as P;
        if (row.status === PARKED) {
            const refusal: FarmSetupRefusal = {
                rowId: row.id ?? 0, clientRequestId: row.clientRequestId, mutationType: row.mutationType, errorCode: row.errorCode ?? null,
                kind: refusalKindOf(row.errorCode), payload: p,
            };
            refused.push(refusal);
            // the SERVER's item stays as it is, marked; a new item the server never had is shown from what he sent, marked refused
            if (row.mutationType === SyncMutationName.FarmsetupWaterSourceSave || row.mutationType === SyncMutationName.FarmsetupWaterSourceRemove) {
                const id = String(p.waterSourceId);
                const had = sources.get(id);
                sources.set(id, had ? { ...had, state: 'refused', refusal } : { item: waterSourceFromPayload(p, 0, row.createdAt), state: 'refused', refusal });
            } else if (row.mutationType === SyncMutationName.FarmsetupMachineSave || row.mutationType === SyncMutationName.FarmsetupMachineRemove) {
                const id = String(p.machineId);
                const had = machines.get(id);
                machines.set(id, had ? { ...had, state: 'refused', refusal } : { item: machineFromPayload(p, 0, row.createdAt), state: 'refused', refusal });
            } else if (row.mutationType === SyncMutationName.FarmsetupPlotWaterSet) {
                const id = String(p.plotId);
                const had = plots.get(id);
                plots.set(id, had ? { ...had, state: 'refused', refusal } : { item: plotWaterFromPayload(p, 0, row.createdAt), state: 'refused', refusal });
            } else if (power) {
                power = { ...power, state: 'refused', refusal };
            } else {
                power = { item: { revision: 0, updatedAtUtc: row.createdAt, timetable: p.timetable as FarmSetupTimetable }, state: 'refused', refusal };
            }
            continue;
        }
        waitingCount += 1;
        switch (row.mutationType) {
            case SyncMutationName.FarmsetupWaterSourceSave: {
                const id = String(p.waterSourceId);
                sources.set(id, { item: waterSourceFromPayload(p, serverRevision.source.get(id) ?? 0, row.createdAt), state: 'waiting', refusal: null });
                break;
            }
            case SyncMutationName.FarmsetupWaterSourceRemove:
                sources.delete(String(p.waterSourceId));
                break;
            case SyncMutationName.FarmsetupMachineSave: {
                const id = String(p.machineId);
                machines.set(id, { item: machineFromPayload(p, serverRevision.machine.get(id) ?? 0, row.createdAt), state: 'waiting', refusal: null });
                break;
            }
            case SyncMutationName.FarmsetupMachineRemove:
                machines.delete(String(p.machineId));
                break;
            case SyncMutationName.FarmsetupPlotWaterSet: {
                const id = String(p.plotId);
                plots.set(id, { item: plotWaterFromPayload(p, plots.get(id)?.item.revision ?? 0, row.createdAt), state: 'waiting', refusal: null });
                break;
            }
            case SyncMutationName.FarmsetupPowerTimesSet:
                power = { item: { revision: set?.powerTimes?.revision ?? 0, updatedAtUtc: row.createdAt, timetable: p.timetable as FarmSetupTimetable }, state: 'waiting', refusal: null };
                break;
        }
    }

    return {
        farmId,
        received: set !== null,
        waterSources: [...sources.values()].sort(byName),
        machines: [...machines.values()].sort(byName),
        powerTimes: power,
        plotWater: plots,
        waitingCount,
        refused,
    };
}
