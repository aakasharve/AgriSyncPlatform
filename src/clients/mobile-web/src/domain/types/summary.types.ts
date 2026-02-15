/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain Summary Types
 *
 * Types for daily work summaries and comparisons (Reflect/Compare pages).
 * No imports from features/ or UI. This is the canonical location.
 *
 * Layer: Domain (can only import from other domain types)
 */

import type { IrrigationEvent, LabourEvent, MachineryEvent } from './log.types';
import type { WeatherSnapshot } from './weather.types';

// =============================================================================
// DAILY WORK SUMMARY (Reflect Page)
// =============================================================================

export interface DayWorkSummary {
    date: string;
    totalCost: number; // Derived from all events, not independently stored
    activities?: {
        titles: string[];
        count: number;
    };
    labour: LabourSummary;
    irrigation: IrrigationSummary;
    machinery: MachinerySummary;
    inputs: InputsSummary;
    notes?: NotesSummary;
    weather?: WeatherSnapshot; // Optional, demoted to secondary
    // Attribution
    loggedBy?: string;
    loggedAt?: string;
    verifiedBy?: string;
    verificationStatus?: string;
}

export interface LabourSummary {
    maleCount: number;
    femaleCount: number;
    maleRate: number;
    femaleRate: number;
    hoursWorked: number;
    totalCost: number;
    isEmpty: boolean;
    events: LabourEvent[];
}

export interface IrrigationSummary {
    method: 'Drip' | 'Flood' | 'Sprinkler' | 'None';
    durationHours: number;
    source: string;
    cost: number;
    occurred: boolean;
    isEmpty: boolean;
    events: IrrigationEvent[];
}

export interface MachinerySummary {
    machineType: string;
    purpose: string;
    fuelCost: number;
    rentalCost: number;
    totalCost: number;
    isEmpty: boolean;
    events: MachineryEvent[];
}

export interface InputsSummary {
    items: InputItem[];
    totalCost: number;
    isEmpty: boolean;
}

export interface InputItem {
    name: string;
    quantity: number;
    unit: string;
    applicationMethod: string;
    individualCost: number;
    /** Classification for Spray vs Nutrition routing */
    inputType?: 'fertilizer' | 'pesticide' | 'fungicide' | 'bio' | 'other' | 'unknown';
}

export interface NotesSummary {
    content: string;
    exists: boolean;
}

export interface CostBreakdown {
    labour: number;
    inputs: number;
    machinery: number;
    total: number;
}

// =============================================================================
// COMPARE PAGE TYPES
// =============================================================================

export type StageCode =
    | 'ESTABLISHMENT'
    | 'VEGETATIVE'
    | 'FLOWERING_FRUIT_SET'
    | 'FRUIT_GROWTH'
    | 'FRUIT_MATURITY'
    | 'EARLY_GROWTH'
    | 'CUSTOM';

// Stage-level comparison unit
export interface StageComparisonUnit {
    stageId: string;
    stageName: string;
    stageCode: StageCode;

    // Temporal bounds
    plannedStartDay: number;
    plannedEndDay: number;
    actualStartDate?: string;
    actualEndDate?: string;

    // Status
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'SKIPPED';
    completionPercent: number;

    // Execution buckets
    buckets: ExecutionBucket[];

    // Phase 3: Issues
    issues: IssueSummary[];
}

export interface IssueSummary {
    id: string;
    date: string;
    dayNumber: number; // relative to ref
    description: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    source: 'OBSERVATION' | 'EVENT';
    logId: string;
}

// Bucket = Category of work (Sprays, Fertigation, Irrigation, Activities)
export interface ExecutionBucket {
    bucketType: 'SPRAY' | 'FERTIGATION' | 'IRRIGATION' | 'ACTIVITY' | 'OTHER';
    bucketLabel: string;

    // Plan vs Execution
    planned: PlannedItem[];
    executed: ExecutedItem[];

    // Computed
    plannedCount: number;
    executedCount: number;
    matchedCount: number;
    extraCount: number;
    missedCount: number;

    // Health indicator
    health: 'ON_TRACK' | 'SLIGHT_LAG' | 'SIGNIFICANT_LAG' | 'CRITICAL';
}

export interface PlannedItem {
    id: string;
    name: string;
    expectedDay?: number;
    expectedWindow?: { start: number; end: number };
    frequency?: string;
    quantity?: number;
    unit?: string;
    notes?: string;

    // Match status
    isMatched: boolean;
    matchedExecutionId?: string;

    // Status
    status?: 'UPCOMING' | 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED';
}

export interface ExecutedItem {
    id: string;
    sourceLogId: string;
    sourceEventId: string;

    name: string;
    executedDate: string;
    executedDay: number;
    quantity?: number;
    unit?: string;
    cost?: number;

    // Match status
    isMatchedToPlan: boolean;
    matchedPlanItemId?: string;
    isExtra: boolean;
}

// Plot-level comparison summary
export interface PlotComparisonSummary {
    plotId: string;
    plotName: string;
    cropId: string;
    cropName: string;

    // Reference
    referenceDate: string;
    currentDay: number;

    // Current stage
    currentStage?: StageComparisonUnit;

    // All stages
    stages: StageComparisonUnit[];

    // Overall health
    overallHealth: 'EXCELLENT' | 'GOOD' | 'NEEDS_ATTENTION' | 'CRITICAL';
    overallCompletionPercent: number;

    // Key metrics
    totalPlanned: number;
    totalExecuted: number;
    totalMissed: number;
    totalExtra: number;

    // Cost tracking
    plannedCostEstimate?: number;
    actualCostSpent: number;
}

// Compare page state
export interface ComparePageState {
    selectedPlotId: string | null;
    selectedStageId: string | null;
    viewMode: 'OVERVIEW' | 'STAGE_DETAIL' | 'BUCKET_DETAIL';
    timeFilter: 'CURRENT_STAGE' | 'ALL_STAGES' | 'CUSTOM';
}
