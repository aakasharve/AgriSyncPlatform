// --- GENERIC SCHEDULER SCHEMA ---

// Layer 1: Core Concepts
export type ScheduleReferenceType = 'PLANTING' | 'SOWING' | 'TRANSPLANTING' | 'PRUNING';

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
export type FrequencyMode = 'PER_WEEK' | 'EVERY_N_DAYS';

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

// Overrides allow per-plot customization without breaking the link to template
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

// -----------------------------------------------------------

// Legacy Irrigation Schedule/Plan (To be deprecated)
export type IrrigationFrequency = 'Daily' | 'Alternate' | 'Every 3 Days' | 'Weekly' | 'Variable';
export type IrrigationTimeWindow = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

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
