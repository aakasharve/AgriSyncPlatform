// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - the rows of the Dexie stores `farmWaterSources`, `farmMachines`,
// `farmPowerTimes` and `plotWater` (schema v33), and the readers that turn one `farmSetup` entry of the pull into them.
//
// SERVER CACHE ONLY (P10): one row = what the server holds, as the last pull that carried the farm said (the pull sends each farm FULL). A change made on
// this phone and not yet answered is NOT a row here: it stays in the mutation queue, and `getLocalFarmSetup` (features/profile/farmSetup/farmSetupLocal.ts)
// lays it over these rows with a mark, so queued intent is never drawn as saved.
//
// `farmPowerTimes` holds ONE row per farm the server sent, even when the farm has no timetable (`powerTimes: null`): that row is how the phone tells "the
// server sent this farm, and it is empty" from "the server never sent it" (an old server, or before the first pull that asked).
//
// A row that cannot be read is skipped and counted, never stored half (the pattern of `ownScheduleItemRowFromDto`). A water source with ONE unreadable
// motor is skipped whole: its next save sends its whole motor list, and a motor dropped here would be removed on the server by that save.
import { PowerPhaseScheduleSchema } from '../../../../../../sync-contract/schemas/payloads/farmsetup_power_times_set.zod';
import type {
    FarmMachineOwnership, FarmMachineType, FarmMotorPowerSource, FarmSetupMachine, FarmSetupMotor, FarmSetupMotorDrip, FarmSetupPowerTimes,
    FarmSetupSet, FarmSetupWaterSource, FarmWaterSourceType, PlotWaterLink, PlotWaterMethod, PlotWaterSetup,
} from '../../domain/types/farmSetup.types';
import { FARM_MACHINE_TYPES, FARM_MOTOR_POWER_SOURCES, FARM_WATER_SOURCE_TYPES, PLOT_WATER_METHODS } from '../../domain/types/farmSetup.types';

export type FarmWaterSourceRow = FarmSetupWaterSource;
export type FarmMachineRow = FarmSetupMachine;
export type PlotWaterRow = PlotWaterSetup;
/** One per farm the server sent (the "this farm was sent" mark), with the farm's timetable or null. */
export interface FarmPowerTimesRow {
    farmId: string;
    powerTimes: FarmSetupPowerTimes | null;
    receivedAtUtc: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGuid = (v: unknown): v is string => typeof v === 'string' && GUID.test(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isRevision = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const textOrNull = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : typeof v === 'string' ? v : undefined);
const numberOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : isNumber(v) ? v : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

function dripFrom(input: unknown): FarmSetupMotorDrip | null | undefined {
    if (input === null || input === undefined) return null;
    const d = asRecord(input);
    if (!d || typeof d.hasFilter !== 'boolean') return undefined;
    const pipeSize = textOrNull(d.pipeSize);
    const flow = numberOrNull(d.flowLitresPerHour);
    if (pipeSize === undefined || flow === undefined) return undefined;
    return { pipeSize, hasFilter: d.hasFilter, flowLitresPerHour: flow };
}

function motorFrom(input: unknown): FarmSetupMotor | null {
    const m = asRecord(input);
    if (!m || !isGuid(m.id) || !isText(m.name) || !isNumber(m.hp) || (m.phase !== 1 && m.phase !== 3)
        || !oneOf<FarmMotorPowerSource>(FARM_MOTOR_POWER_SOURCES, m.powerSource)) return null;
    const powerSourceName = textOrNull(m.powerSourceName);
    const drip = dripFrom(m.drip);
    if (powerSourceName === undefined || drip === undefined) return null;
    return { id: m.id, name: m.name, hp: m.hp, phase: m.phase, powerSource: m.powerSource, powerSourceName, drip };
}

function waterSourceFrom(input: unknown, farmId: string): FarmWaterSourceRow | null {
    const s = asRecord(input);
    if (!s || !isGuid(s.id) || !isRevision(s.revision) || !isText(s.name) || !oneOf<FarmWaterSourceType>(FARM_WATER_SOURCE_TYPES, s.sourceType)
        || typeof s.isAvailable !== 'boolean' || !Array.isArray(s.motors) || !isText(s.updatedAtUtc)) return null;
    const notes = textOrNull(s.notes);
    if (notes === undefined) return null;
    const motors = s.motors.map(motorFrom);
    if (motors.some(m => m === null)) return null;
    return {
        id: s.id, farmId, revision: s.revision, name: s.name, sourceType: s.sourceType, isAvailable: s.isAvailable, notes,
        motors: motors as FarmSetupMotor[], updatedAtUtc: s.updatedAtUtc,
    };
}

function machineFrom(input: unknown, farmId: string): FarmMachineRow | null {
    const m = asRecord(input);
    if (!m || !isGuid(m.id) || !isRevision(m.revision) || !isText(m.name) || !oneOf<FarmMachineType>(FARM_MACHINE_TYPES, m.machineType)
        || (m.ownership !== 'owned' && m.ownership !== 'rented') || !isText(m.updatedAtUtc)) return null;
    const company = textOrNull(m.company);
    const model = textOrNull(m.model);
    const detailLine = textOrNull(m.detailLine);
    const hp = numberOrNull(m.hp);
    const nozzleCount = numberOrNull(m.nozzleCount);
    const tankLitres = numberOrNull(m.tankLitres);
    if ([company, model, detailLine, hp, nozzleCount, tankLitres].some(v => v === undefined)) return null;
    return {
        id: m.id, farmId, revision: m.revision, name: m.name, machineType: m.machineType, ownership: m.ownership as FarmMachineOwnership,
        company: company!, model: model!, hp: hp!, nozzleCount: nozzleCount!, tankLitres: tankLitres!, detailLine: detailLine!, updatedAtUtc: m.updatedAtUtc,
    };
}

function linkFrom(input: unknown): PlotWaterLink | null {
    const l = asRecord(input);
    if (!l || !isGuid(l.waterSourceId)) return null;
    if (l.motorId !== null && l.motorId !== undefined && !isGuid(l.motorId)) return null;
    return { waterSourceId: l.waterSourceId, motorId: (l.motorId as string | null | undefined) ?? null };
}

function plotWaterFrom(input: unknown, farmId: string): PlotWaterRow | null {
    const p = asRecord(input);
    if (!p || !isGuid(p.plotId) || !isRevision(p.revision) || !oneOf<PlotWaterMethod>(PLOT_WATER_METHODS, p.method)
        || !Array.isArray(p.links) || !isText(p.updatedAtUtc)) return null;
    const links = p.links.map(linkFrom);
    if (links.some(l => l === null)) return null;
    return { plotId: p.plotId, farmId, revision: p.revision, method: p.method, links: links as PlotWaterLink[], updatedAtUtc: p.updatedAtUtc };
}

function powerTimesFrom(input: unknown): FarmSetupPowerTimes | null {
    const p = asRecord(input);
    const t = asRecord(p?.timetable);
    if (!p || !t || !isRevision(p.revision) || !isText(p.updatedAtUtc)) return null;
    const single = PowerPhaseScheduleSchema.safeParse(t.singlePhase);
    const three = PowerPhaseScheduleSchema.safeParse(t.threePhase);
    if (!single.success || !three.success) return null;
    return { revision: p.revision, updatedAtUtc: p.updatedAtUtc, timetable: { singlePhase: single.data, threePhase: three.data } };
}

export interface FarmSetupRead {
    set: FarmSetupSet;
    /** Rows that could not be read and were left out. */
    skipped: number;
}

/** One `farmSetup` entry of the pull, or null when the entry itself cannot be read (no farm id, or not the server's shape). */
export function farmSetupFromDto(input: unknown, receivedAtUtc: string): FarmSetupRead | null {
    const d = asRecord(input);
    if (!d || !isGuid(d.farmId) || !Array.isArray(d.waterSources) || !Array.isArray(d.machines) || !Array.isArray(d.plotWater) || !('powerTimes' in d)) return null;
    const farmId = d.farmId;
    let skipped = 0;
    const keep = <T>(rows: unknown[], read: (row: unknown) => T | null): T[] => rows.flatMap(row => {
        const r = read(row);
        if (r === null) { skipped += 1; return []; }
        return [r];
    });
    const waterSources = keep(d.waterSources, row => waterSourceFrom(row, farmId));
    const machines = keep(d.machines, row => machineFrom(row, farmId));
    const plotWater = keep(d.plotWater, row => plotWaterFrom(row, farmId));
    let powerTimes: FarmSetupPowerTimes | null = null;
    if (d.powerTimes !== null) {
        powerTimes = powerTimesFrom(d.powerTimes);
        if (powerTimes === null) skipped += 1;
    }
    return { set: { farmId, waterSources, powerTimes, machines, plotWater, receivedAtUtc }, skipped };
}
