/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, founder 27 Nov: "send it to server; the phone is only a door") - a FARM's setup as the
 * server holds it: its water sources (each with its motors), its power timetable, its machines, and each plot's water arrangement. Bare GUID ids, the
 * server's `revision` of each versioned unit, the wire's lower-case values. An optional detail the server does not know is `null` here (it is `null`
 * on the pull); on the push it is LEFT OUT (the contract's Zod refuses null).
 *
 * Pure types: no import from infrastructure/ or pages/ (layering rule).
 */
import type { ElectricityPhaseSchedule } from './farm.types';

export type FarmWaterSourceType = 'well' | 'borewell' | 'canal' | 'farm_pond' | 'tanker';
export type FarmMotorPowerSource = 'mseb' | 'solar' | 'generator';
export type FarmMachineType = 'tractor' | 'blower' | 'sprayer' | 'rotavator' | 'harvester' | 'other';
export type FarmMachineOwnership = 'owned' | 'rented';
/** `none` = he said "पाण्याची सोय नाही"; a plot with no entry at all was never asked (बाकी). */
export type PlotWaterMethod = 'drip' | 'flood' | 'sprinkler' | 'none';

export const FARM_WATER_SOURCE_TYPES: readonly FarmWaterSourceType[] = ['well', 'borewell', 'canal', 'farm_pond', 'tanker'];
export const FARM_MOTOR_POWER_SOURCES: readonly FarmMotorPowerSource[] = ['mseb', 'solar', 'generator'];
export const FARM_MACHINE_TYPES: readonly FarmMachineType[] = ['tractor', 'blower', 'sprayer', 'rotavator', 'harvester', 'other'];
export const PLOT_WATER_METHODS: readonly PlotWaterMethod[] = ['drip', 'flood', 'sprinkler', 'none'];

export interface FarmSetupMotorDrip {
    pipeSize: string | null;
    hasFilter: boolean;
    flowLitresPerHour: number | null;
}

/** A motor has no revision of its own: its source's counts (the source and its motors are ONE versioned unit). */
export interface FarmSetupMotor {
    id: string;
    name: string;
    hp: number;
    phase: 1 | 3;
    powerSource: FarmMotorPowerSource;
    powerSourceName: string | null;
    drip: FarmSetupMotorDrip | null;
}

export interface FarmSetupWaterSource {
    id: string;
    farmId: string;
    revision: number;
    name: string;
    sourceType: FarmWaterSourceType;
    isAvailable: boolean;
    notes: string | null;
    motors: FarmSetupMotor[];
    updatedAtUtc: string;
}

export interface FarmSetupTimetable {
    singlePhase: ElectricityPhaseSchedule;
    threePhase: ElectricityPhaseSchedule;
}

export interface FarmSetupPowerTimes {
    revision: number;
    updatedAtUtc: string;
    timetable: FarmSetupTimetable;
}

export interface FarmSetupMachine {
    id: string;
    farmId: string;
    revision: number;
    name: string;
    machineType: FarmMachineType;
    ownership: FarmMachineOwnership;
    company: string | null;
    model: string | null;
    hp: number | null;
    nozzleCount: number | null;
    tankLitres: number | null;
    detailLine: string | null;
    updatedAtUtc: string;
}

/** A canal by gravity has no motor: `motorId` null. */
export interface PlotWaterLink {
    waterSourceId: string;
    motorId: string | null;
}

export interface PlotWaterSetup {
    plotId: string;
    farmId: string;
    revision: number;
    method: PlotWaterMethod;
    links: PlotWaterLink[];
    updatedAtUtc: string;
}

/** One farm's whole set, as the last pull that carried it said. */
export interface FarmSetupSet {
    farmId: string;
    waterSources: FarmSetupWaterSource[];
    powerTimes: FarmSetupPowerTimes | null;
    machines: FarmSetupMachine[];
    /** Only the plots this person's seat covers (the server sends no other). */
    plotWater: PlotWaterSetup[];
    /** When this phone received it. */
    receivedAtUtc: string;
}
