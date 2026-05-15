// --- GENERIC SCHEDULER SCHEMA ---
//
// Layering note (2026-05-15): the 10 types that `domain/types/farm.types.ts`
// transitively needs were moved to `domain/types/scheduler.types.ts` to
// keep the Frontend Layer Tests gate green (no imports from features/ in
// domain/). This file re-exports them so existing scheduler-feature
// consumers keep working unchanged. The remaining types in this file
// (StageTemplate, OperationType, expectations, CropScheduleTemplate)
// are feature-internal and stay here.

import type {
    ScheduleReferenceType,
    FrequencyMode,
} from '../../domain/types/scheduler.types';

export type {
    ScheduleReferenceType,
    FrequencyMode,
    IrrigationFrequency,
    IrrigationTimeWindow,
    StageOverride,
    ExpectationOverride,
    PlotScheduleInstance,
    ScheduleShiftEvent,
    IrrigationPlan,
    PlotIrrigationConfig,
} from '../../domain/types/scheduler.types';

// (ScheduleReferenceType re-exported from domain/types/scheduler.types
// per the 2026-05-15 Frontend Layer Tests fix.)

// Schedule Ownership
export type ScheduleOwnerType = 'EXPERT' | 'INSTITUTION' | 'USER' | 'SYSTEM_DEFAULT';

// Layer 2: Stage Template
export type StageCode =
    | 'ESTABLISHMENT'
    | 'VEGETATIVE'
    | 'FLOWERING_FRUIT_SET'
    | 'FRUIT_GROWTH'
    | 'FRUIT_MATURITY'
    | 'EARLY_GROWTH'
    | 'CUSTOM';

export interface StageTemplate {
    id: string;
    templateId: string; // FK to CropScheduleTemplate
    name: string;
    code: StageCode;
    dayStart: number;
    dayEnd: number;
    orderIndex: number;
    description?: string;
    notes?: string; // Stage-level fixed guidance note (required in library-facing templates)
}

// (FrequencyMode re-exported from domain/types/scheduler.types — moved
// for the layer gate.)

// Layer 3: Operation Types
export type OperationCategory =
    | 'IRRIGATION'
    | 'FERTIGATION'
    | 'FOLIAR_SPRAY'
    | 'SOIL_AMENDMENT'
    | 'WEED_CONTROL'
    | 'CULTURAL_OPERATION' // pruning, gap filling, etc
    | 'OTHER';

export interface OperationType {
    id: string;
    category: OperationCategory;
    name: string; // "Drip Irrigation", "Foliar Spray", "Hand Weeding"
    deliveryMode?: 'SOIL' | 'DRIP' | 'FOLIAR' | 'MECHANICAL';
}

// Layer 4: Stage Expectations
// (FrequencyMode moved to domain/types/scheduler.types; re-exported above.)

export interface PeriodicExpectation {
    id: string;
    stageId: string;
    operationTypeId: string; // e.g. "opt_irrig_drip"
    frequencyMode: FrequencyMode;
    frequencyValue: number;
    notes?: string;
}

export interface OneTimeExpectation {
    id: string;
    stageId: string; // or templateId
    operationTypeId: string;
    targetDayFromRef: number;
    toleranceDays?: number;
    notes?: string;
}

// Layer 5: Templates & Instances
export interface CropScheduleTemplate {
    id: string;
    cropCode: string; // 'tomato', 'grape', 'sugarcane'
    name: string;
    referenceType: ScheduleReferenceType;
    stages: StageTemplate[];
    // Default expectations defined in the template
    periodicExpectations: PeriodicExpectation[];
    oneTimeExpectations: OneTimeExpectation[];

    // Schedule Owner Metadata
    createdBy: string;              // Name of the creator
    ownerType: ScheduleOwnerType;   // EXPERT | INSTITUTION | USER | SYSTEM_DEFAULT
    description?: string;           // Brief description of the schedule
    totalDurationDays?: number;     // Total crop cycle duration
    adoptionScore?: number;         // 0-100 (dummy/demo score for now)
    detailScore?: number;           // 0-100 (dummy/demo score for now)
    followersCount?: number;        // Dummy/demo followers for now
    publishedAt?: string;           // ISO date, used for "Newest" sort in library
}

// Overrides allow per-plot customization — definitions moved to
// domain/types/scheduler.types; re-exported above for back-compat.
// PlotScheduleInstance, ScheduleShiftEvent, IrrigationPlan,
// PlotIrrigationConfig, IrrigationFrequency, IrrigationTimeWindow,
// StageOverride, ExpectationOverride — all live in
// `../../domain/types/scheduler.types` now.
