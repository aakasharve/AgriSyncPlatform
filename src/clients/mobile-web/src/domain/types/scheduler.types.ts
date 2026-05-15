/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Scheduler Types — canonical definitions for the scheduler
 * concepts that the domain layer (farm.types.ts and downstream) needs to
 * reference without crossing the layer boundary into features/.
 *
 * Why this file exists: `farm.types.ts` used to import these types from
 * `features/scheduler/scheduler.types.ts`, which the Frontend Layer Tests
 * gate (CI scan for `from [^;]*(infrastructure|/pages/|/features/)` inside
 * `src/clients/mobile-web/src/domain/`) correctly rejects. The 10 types
 * below are the minimal closure that `farm.types.ts` transitively needs;
 * the features/scheduler module now re-exports them from here so all the
 * existing scheduler-feature consumers keep working unchanged.
 *
 * Layer: Domain (can only import from other domain types — no imports here).
 */

// =============================================================================
// REFERENCE TYPES (atomic)
// =============================================================================

export type ScheduleReferenceType = 'PLANTING' | 'SOWING' | 'TRANSPLANTING' | 'PRUNING';

export type FrequencyMode = 'PER_WEEK' | 'EVERY_N_DAYS';

export type IrrigationFrequency = 'Daily' | 'Alternate' | 'Every 3 Days' | 'Weekly' | 'Variable';
export type IrrigationTimeWindow = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

// =============================================================================
// OVERRIDE TYPES
// =============================================================================

export interface StageOverride {
    stageId: string; // FK to StageTemplate.id
    customDayStart?: number;
    customDayEnd?: number;
}

export interface ExpectationOverride {
    expectationId: string; // FK to PeriodicExpectation.id
    customFrequencyMode?: FrequencyMode;
    customFrequencyValue?: number;
}

// =============================================================================
// PLOT-LEVEL SCHEDULER ENTITIES (imported by farm.types.ts)
// =============================================================================

export interface PlotScheduleInstance {
    id: string;
    plotId: string;
    templateId: string; // The template this is based on
    referenceType: ScheduleReferenceType;
    referenceDate: string; // ISO Date

    // Customizations
    stageOverrides: StageOverride[];
    expectationOverrides: ExpectationOverride[];

    // Legacy/UI compatibility — inline stages (to be deprecated in favor of template lookup)
    stages?: unknown[];
}

export interface ScheduleShiftEvent {
    id: string;
    plotId: string;
    date: string; // The date the shift was decided/occurred
    shiftDays: number; // e.g. +1, +2
    reason: 'WEATHER' | 'LABOUR' | 'WATER' | 'MARKET' | 'OTHER';
    evidenceWeatherEventIds?: string[]; // Link to WeatherEvent
    note?: string;
}

// =============================================================================
// LEGACY IRRIGATION (deprecated in favor of PlotScheduleInstance)
// =============================================================================

export interface IrrigationPlan {
    // Deprecated in favor of PlotSchedule
    frequency: IrrigationFrequency;
    durationMinutes: number;
    preferredTime: IrrigationTimeWindow;
    planStartDate: string;
    seasonalAdjustment?: 'Summer' | 'Winter' | 'Monsoon' | 'None';
    method?: string;
    motorId?: string;
    dripFlowRatePerHour?: number;
}

export interface PlotIrrigationConfig {
    // Deprecated
    defaultMethod: string;
    defaultMotorId?: string;
    frequencyHint?: 'Daily' | 'Alternate' | 'Weekly' | 'Variable';
}
