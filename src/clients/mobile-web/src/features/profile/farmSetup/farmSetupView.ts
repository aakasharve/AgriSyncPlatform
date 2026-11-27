/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone tasks P4-P6) - the farm's set (wire values, bare GUIDs) as the shapes the setup
 * forms already draw (`WaterResource`, `FarmMotor`, `FarmMachinery`: display values such as 'Well', 'MSEB', '3'), and back. Only the mapping lives here,
 * so the forms keep their fields, words and tests; what is SAVED goes through the farm-setup doors (`farmSetupCommands`). Pure: no React, no storage.
 *
 * Not carried to the server (contract §6 rule 9): a motor's made-up `schedule`, a machine's `defaultOperatorId` (no screen sets it).
 */
import type { FarmMachinery, FarmMotor, WaterResource } from '../../../domain/types/farm.types';
import type {
    FarmMachineType, FarmMotorPowerSource, FarmSetupMachine, FarmSetupMotor, FarmSetupWaterSource, FarmWaterSourceType,
} from '../../../domain/types/farmSetup.types';
import type { MachineInput, MotorInput, WaterSourceInput } from './farmSetupCommands';

export const SOURCE_TYPE_TO_WIRE: Record<WaterResource['type'], FarmWaterSourceType> = {
    Well: 'well', Borewell: 'borewell', Canal: 'canal', 'Farm Pond': 'farm_pond', Tanker: 'tanker',
};
export const SOURCE_TYPE_FROM_WIRE: Record<FarmWaterSourceType, WaterResource['type']> = {
    well: 'Well', borewell: 'Borewell', canal: 'Canal', farm_pond: 'Farm Pond', tanker: 'Tanker',
};
export const POWER_TO_WIRE: Record<FarmMotor['powerSourceType'], FarmMotorPowerSource> = { MSEB: 'mseb', Solar: 'solar', Generator: 'generator' };
export const POWER_FROM_WIRE: Record<FarmMotorPowerSource, FarmMotor['powerSourceType']> = { mseb: 'MSEB', solar: 'Solar', generator: 'Generator' };
export const MACHINE_TYPE_TO_WIRE: Record<FarmMachinery['type'], FarmMachineType> = {
    Tractor: 'tractor', Blower: 'blower', Sprayer: 'sprayer', Rotavator: 'rotavator', Harvester: 'harvester', Other: 'other',
};
export const MACHINE_TYPE_FROM_WIRE: Record<FarmMachineType, FarmMachinery['type']> = {
    tractor: 'Tractor', blower: 'Blower', sprayer: 'Sprayer', rotavator: 'Rotavator', harvester: 'Harvester', other: 'Other',
};

const orUndefined = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function toWaterResource(s: FarmSetupWaterSource): WaterResource {
    return { id: s.id, type: SOURCE_TYPE_FROM_WIRE[s.sourceType], name: s.name, isAvailable: s.isAvailable, ...(s.notes ? { notes: s.notes } : {}) };
}

export function toFarmMotor(m: FarmSetupMotor, waterSourceId: string): FarmMotor {
    return {
        id: m.id, name: m.name, hp: m.hp, phase: m.phase === 1 ? '1' : '3', powerSourceType: POWER_FROM_WIRE[m.powerSource],
        ...(m.powerSourceName ? { powerSourceName: m.powerSourceName } : {}),
        linkedWaterSourceId: waterSourceId,
        ...(m.drip ? { dripDetails: { hasFilter: m.drip.hasFilter, ...(m.drip.pipeSize ? { pipeSize: m.drip.pipeSize } : {}), ...(m.drip.flowLitresPerHour ? { flowRatePerHour: m.drip.flowLitresPerHour } : {}) } } : {}),
    };
}

export function motorInputOf(m: FarmMotor, motorId: string = m.id): MotorInput {
    return {
        motorId, name: m.name, hp: m.hp, phase: m.phase === '1' ? 1 : 3, powerSource: POWER_TO_WIRE[m.powerSourceType], powerSourceName: m.powerSourceName ?? null,
        drip: m.dripDetails ? { pipeSize: m.dripDetails.pipeSize ?? null, hasFilter: m.dripDetails.hasFilter, flowLitresPerHour: m.dripDetails.flowRatePerHour ?? null } : null,
    };
}

export function waterSourceInputOf(farmId: string, source: WaterResource, motors: readonly FarmMotor[]): WaterSourceInput {
    return {
        farmId, waterSourceId: source.id, name: source.name, sourceType: SOURCE_TYPE_TO_WIRE[source.type], isAvailable: source.isAvailable !== false,
        notes: source.notes ?? null, motors: motors.map(m => motorInputOf(m)),
    };
}

export function toMachinery(m: FarmSetupMachine): FarmMachinery {
    return {
        id: m.id, name: m.name, type: MACHINE_TYPE_FROM_WIRE[m.machineType], ownership: m.ownership === 'rented' ? 'Rented' : 'Owned',
        ...(m.company ? { company: m.company } : {}), ...(m.model ? { model: m.model } : {}), ...(m.hp !== null ? { hp: m.hp } : {}),
        ...(m.nozzleCount !== null ? { nozzleCount: m.nozzleCount } : {}), ...(m.tankLitres !== null ? { capacity: m.tankLitres } : {}),
        ...(m.detailLine ? { otherDetails: m.detailLine } : {}),
    };
}

export function machineInputOf(farmId: string, m: FarmMachinery, machineId: string = m.id): MachineInput {
    return {
        farmId, machineId, name: m.name, machineType: MACHINE_TYPE_TO_WIRE[m.type], ownership: m.ownership === 'Rented' ? 'rented' : 'owned',
        company: orUndefined(m.company), model: orUndefined(m.model), hp: orUndefined(m.hp), nozzleCount: orUndefined(m.nozzleCount),
        tankLitres: orUndefined(m.capacity), detailLine: orUndefined(m.otherDetails),
    };
}

/** A queued `water_source.save` payload as the form's two shapes ("माझा बदल पुन्हा करा" re-opens the form with what he typed). */
export function formOfSourcePayload(p: Record<string, unknown>): { source: WaterResource; motors: FarmMotor[] } {
    const id = String(p.waterSourceId);
    const source: WaterResource = {
        id, name: String(p.name ?? ''), type: SOURCE_TYPE_FROM_WIRE[(p.sourceType as FarmWaterSourceType) ?? 'well'] ?? 'Well', isAvailable: p.isAvailable !== false,
        ...(typeof p.notes === 'string' ? { notes: p.notes } : {}),
    };
    const motors = (Array.isArray(p.motors) ? p.motors as Record<string, unknown>[] : []).map(m => {
        const drip = m.drip && typeof m.drip === 'object' ? m.drip as Record<string, unknown> : null;
        return toFarmMotor({
            id: String(m.motorId), name: String(m.name ?? ''), hp: Number(m.hp ?? 0), phase: m.phase === 1 ? 1 : 3,
            powerSource: (m.powerSource as FarmMotorPowerSource) ?? 'mseb', powerSourceName: typeof m.powerSourceName === 'string' ? m.powerSourceName : null,
            drip: drip ? { pipeSize: typeof drip.pipeSize === 'string' ? drip.pipeSize : null, hasFilter: drip.hasFilter === true, flowLitresPerHour: typeof drip.flowLitresPerHour === 'number' ? drip.flowLitresPerHour : null } : null,
        }, id);
    });
    return { source, motors };
}

/** A queued `machine.save` payload as the machine form's draft. */
export function formOfMachinePayload(p: Record<string, unknown>): FarmMachinery {
    return toMachinery({
        id: String(p.machineId), farmId: String(p.farmId), revision: 0, name: String(p.name ?? ''), machineType: (p.machineType as FarmMachineType) ?? 'tractor',
        ownership: p.ownership === 'rented' ? 'rented' : 'owned', company: typeof p.company === 'string' ? p.company : null, model: typeof p.model === 'string' ? p.model : null,
        hp: typeof p.hp === 'number' ? p.hp : null, nozzleCount: typeof p.nozzleCount === 'number' ? p.nozzleCount : null,
        tankLitres: typeof p.tankLitres === 'number' ? p.tankLitres : null, detailLine: typeof p.detailLine === 'string' ? p.detailLine : null, updatedAtUtc: '',
    });
}
