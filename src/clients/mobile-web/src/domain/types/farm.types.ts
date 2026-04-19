/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Farm Types
 *
 * Pure domain types for farm structure, plots, crops, and infrastructure.
 * No imports from features/ or UI. This is the canonical location.
 *
 * Layer: Domain (can only import from other domain types)
 *
 * Note: Scheduler types are imported from features/scheduler since they are
 * standalone feature types that don't depend on farm types.
 */

import type {
    PlotScheduleInstance,
    ScheduleShiftEvent,
    PlotIrrigationConfig,
    IrrigationPlan,
} from '../../features/scheduler/scheduler.types';

// =============================================================================
// UNITS & MEASUREMENTS
// =============================================================================

export type LandUnit = 'Acre' | 'Guntha' | 'Are';

// =============================================================================
// GEO TYPES
// =============================================================================

export interface GeoPoint {
    lat: number;
    lng: number;
}

export interface PlotGeo {
    lat: number;
    lon: number;
    source: 'google_maps' | 'manual' | 'approx';
    accuracyMeters?: number;
    updatedAt?: string;
    centroidLat?: number;
    centroidLon?: number;
}

export interface PlotGeoData {
    boundary: GeoPoint[]; // Array of lat/lng defining the polygon
    center: GeoPoint;     // Centroid for marker placement
    calculatedAreaAcres: number;
    drawnAt: string;      // ISO String
}

// =============================================================================
// PLOT BASELINE & INFRASTRUCTURE
// =============================================================================

export interface PlotBaseline {
    totalArea?: number;
    unit: LandUnit;
    totalRows?: number;
    totalPlants?: number;
    rowSpacing?: number; // Feet
    plantSpacing?: number; // Feet
}

export interface LandPrepInfo {
    startedAt?: string; // ISO Date
    estimatedDays?: number;
    notes?: string;
}

export interface PlantingMaterial {
    type: 'Seed' | 'Nursery';
    // Seed specific
    seedCompany?: string;
    seedQuantity?: number;
    seedUnit?: string;
    // Nursery specific
    nurseryName?: string;
    plantAgeDays?: number;
}

export interface DripDetails {
    pipeSize?: string; // 16mm, 20mm
    hasFilter: boolean;
    flowRatePerHour?: number; // L/hr per acre or total
}

export interface PlotInfrastructure {
    irrigationMethod: 'Drip' | 'Flood' | 'Sprinkler' | 'None';
    linkedMotorId?: string; // Hard link to FarmMotor
    dripDetails?: DripDetails;
    linkedMachineryIds?: string[]; // IDs of blowers/tractors usually used here
}

// =============================================================================
// PLOT (The Land Unit)
// =============================================================================

/**
 * Plot - A discrete piece of land with a specific crop cycle.
 * Plots are the primary unit of work tracking.
 */
export interface Plot {
    id: string;
    name: string;
    variety?: string;
    startDate?: string; // Cycle Start Date
    createdAt?: string;
    landPrep?: LandPrepInfo;
    baseline: PlotBaseline;

    // Setup Fields
    plantingMaterial?: PlantingMaterial;
    infrastructure?: PlotInfrastructure;

    // Scheduler Model — MANDATORY: Every plot must have an adopted schedule
    schedule: PlotScheduleInstance;

    // Geo Data (The Truth)
    geo?: PlotGeo;
    geoData?: PlotGeoData; // Legacy polygon data

    // Schedule Adaptation
    scheduleShifts?: ScheduleShiftEvent[];

    // Legacy / Schedule (mark deprecated)
    irrigationConfig?: PlotIrrigationConfig; // @deprecated
    irrigationPlan?: IrrigationPlan;         // @deprecated
}

// =============================================================================
// CROP PROFILE
// =============================================================================

export type CropLifecycle = 'Short (≤120 days)' | 'Medium (120-240 days)' | 'Long (>1 year)';

export interface WorkflowStep {
    id: string;
    name: string; // e.g., "Ethrel Spray", "Pruning"
    type: 'activity' | 'gap' | 'milestone';
    isRepeatable?: boolean;
    defaultDays?: number;
}

export interface SeedInfo {
    sourceType: 'Saved' | 'Purchased';
    nurseryName?: string;
    providerPhone?: string;
}

/**
 * CropProfile - A crop type with its plots and configuration.
 */
export interface CropProfile {
    id: string;
    name: string;
    iconName: string;
    color: string;
    plots: Plot[];
    activeScheduleId?: string | null; // Single adopted baseline schedule for the crop
    lifecycle?: CropLifecycle;
    seedInfo?: SeedInfo;
    supportedTasks: string[];
    workflow: WorkflowStep[];
    contractUnitDefault?: 'Tree' | 'Acre' | 'Row';
    createdAt?: string;
}

// =============================================================================
// FARM INFRASTRUCTURE
// =============================================================================

export interface WaterResource {
    id: string;
    type: 'Well' | 'Borewell' | 'Canal' | 'Farm Pond' | 'Tanker';
    name: string;
    isAvailable: boolean;
    notes?: string;
}

export interface PowerSchedule {
    windowStart: string;
    windowEnd: string;
    days: string[];
    rotationType: 'Weekly' | 'Fixed';
}

export interface ElectricitySchedule {
    dependency: 'Grid' | 'Solar' | 'Mixed';
    loadShedding: {
        morningWindow: string;
        eveningWindow: string;
        notes: string;
    };
}

export type ElectricityPatternMode = 'FIXED_WEEKLY' | 'CUSTOM_DAILY' | 'ROTATIONAL';
export type ElectricityRepeatRule = 'DAILY' | 'WEEKLY' | 'ALTERNATE_WEEK';
export type ElectricityWeekType = 'A' | 'B';

export interface ElectricityOffWindow {
    id: string;
    startTime: string; // HH:mm
    endTime: string;   // HH:mm
    repeatRule: ElectricityRepeatRule;
    days: string[];    // Mon..Sun
}

export interface ElectricityPhaseSchedule {
    patternMode: ElectricityPatternMode;
    alternateWeeklyPattern: boolean;
    weekAOffWindows: ElectricityOffWindow[];
    weekBOffWindows?: ElectricityOffWindow[];
}

export interface ElectricityTimingConfiguration {
    singlePhase: ElectricityPhaseSchedule;
    threePhase: ElectricityPhaseSchedule;
    updatedAt?: string;
}

export interface FarmMotor {
    id: string;
    name: string;
    hp: number;
    phase: '1' | '3';
    powerSourceType: 'MSEB' | 'Solar' | 'Generator';
    powerSourceName?: string;
    linkedWaterSourceId: string;
    schedule?: PowerSchedule;
    dripDetails?: DripDetails;
}

export interface FarmMachinery {
    id: string;
    name: string; // "John Deere 5050"
    type: 'Tractor' | 'Sprayer' | 'Rotavator' | 'Harvester' | 'Other';
    ownership: 'Owned' | 'Rented';
    defaultOperatorId?: string;
    capacity?: number; // Liters (for Sprayers/Blowers)
}

export interface FarmInfrastructure {
    waterManagement: 'Centralized' | 'Decentralized';
    filtrationType: 'Sand' | 'Disc' | 'Screen' | 'None';
}

export interface FarmLocation {
    lat: number;
    lon: number;
    source: 'gps' | 'manual' | 'unknown';
    updatedAt: string;
}

// =============================================================================
// OPERATORS & TRUST
// =============================================================================

export enum OperatorCapability {
    VIEW_ALL = 'VIEW_ALL',
    LOG_DATA = 'LOG_DATA',
    APPROVE_LOGS = 'APPROVE_LOGS',
    MANAGE_PEOPLE = 'MANAGE_PEOPLE',
    MANAGE_SETTINGS = 'MANAGE_SETTINGS'
}

export enum VerificationStatus {
    Unverified = 'Unverified',
    PhoneVerified = 'PhoneVerified',
    GovernmentVerified = 'GovernmentVerified'
}

export interface FarmTrustSettings {
    requirePinForVerification: boolean;
    reviewPolicy: 'ALWAYS_REVIEW' | 'AUTO_APPROVE_OWNER' | 'AUTO_APPROVE_ALL';
    autoApproveDelayDays?: number; // If set, logs auto-approve after N days
}

export interface Person {
    id: string;
    name: string;
    role: string; // e.g. "Labour", "Driver", "Manager"
    phone?: string;
    skills?: string[]; // e.g. ["Spraying", "Harvesting"]
    isActive: boolean;
    capabilities?: OperatorCapability[];
}

export interface FarmOperator {
    id: string;
    name: string;
    role: 'PRIMARY_OWNER' | 'SECONDARY_OWNER' | 'MUKADAM' | 'WORKER';
    phone?: string;
    isActive?: boolean;

    // Trust Layer
    capabilities: OperatorCapability[];
    isVerifier: boolean;
    pinHash?: string; // Optional for MVP

    // Identity & Audit
    assignedBy?: string; // ID of PRIMARY_OWNER or SECONDARY_OWNER who added this person
    joinedAt?: string;   // ISO Date
    verificationStatus?: 'Unverified' | 'Verified_Phone' | 'Verified_FarmerID_Pending';
}

// =============================================================================
// FARMER PROFILE (The Root Aggregate)
// =============================================================================

/**
 * FarmerProfile - The root entity representing the farm and its owner.
 */
export interface FarmerProfile {
    name: string;
    village: string;
    phone: string;
    language: string;
    verificationStatus: VerificationStatus;
    landHoldings?: { value: number; unit: LandUnit };
    operators: FarmOperator[];
    activeOperatorId?: string;
    people?: Person[];
    trust?: FarmTrustSettings;
    location?: FarmLocation;

    // Infrastructure
    waterResources: WaterResource[];
    motors: FarmMotor[];
    electricityTiming?: ElectricityTimingConfiguration;
    machineries?: FarmMachinery[];
    infrastructure: FarmInfrastructure;
}

// =============================================================================
// LABOUR SETTINGS
// =============================================================================

export interface LabourShift {
    id: string;
    name: string; // "Morning Shift", "Full Day"
    startTime?: string;
    endTime?: string;
    defaultRateMale?: number;
    defaultRateFemale?: number;
}

export interface LedgerDefaults {
    irrigation: {
        method: string;
        source: string;
        defaultDuration: number;
    };
    labour: {
        defaultWage: number;
        defaultHours: number;
        shifts: LabourShift[];
    };
    machinery: {
        defaultRentalCost: number;
        defaultFuelCost: number;
    };
}

// =============================================================================
// APP STATE TYPES
// =============================================================================

export type InputMode = 'voice' | 'manual';
export type AppStatus = 'idle' | 'recording' | 'processing' | 'confirming' | 'success' | 'error';
export type PageView = 'log' | 'reflect' | 'compare';
export type AppRoute =
    | 'main'
    | 'profile'
    | 'settings'
    | 'ai-admin'
    | 'schedule'
    | 'procurement'
    | 'income'
    | 'test-e2e'
    | 'finance-manager'
    | 'finance-ledger'
    | 'finance-price-book'
    | 'finance-review-inbox'
    | 'finance-reports'
    | 'finance-settings'
    | 'qr-demo';

export interface AudioData {
    blob: Blob;
    base64: string;
    mimeType: string;
}

export interface AppConfig {
    version: string;
    buildNumber: number;
    features: {
        useVoice: boolean;
        useGps: boolean;
        offlineMode: boolean;
    };
}

// =============================================================================
// ACTIVITY TYPE ENUM
// =============================================================================

export enum ActivityType {
    Irrigation = 'Irrigation',
    Labor = 'Labor',
    Input = 'Input',
    Harvest = 'Harvest',
    Other = 'Other'
}

export interface AgriLogEntry {
    activityType: ActivityType;
    details: string;
    plot?: string;
    quantity?: string;
    cost?: number;
    crop?: string;
}

// =============================================================================
// TODAY COUNTS (Summary type)
// =============================================================================

export interface TodayCounts {
    cropActivities: number;
    irrigation: number;
    labour: number;
    inputs: number;
    machinery: number;
    activityExpenses: number;
    observations: number;
    reminders: number;
    disturbance: number;
    harvest: number;
}

// =============================================================================
// TRANSCRIPTION TYPES
// =============================================================================

export enum Emotion {
    Happy = 'Happy',
    Sad = 'Sad',
    Angry = 'Angry',
    Neutral = 'Neutral'
}

export interface TranscriptionSegment {
    speaker: string;
    timestamp: string;
    language: string;
    content: string;
    emotion?: Emotion;
    translation?: string;
}

export interface TranscriptionResponse {
    summary: string;
    segments: TranscriptionSegment[];
}
