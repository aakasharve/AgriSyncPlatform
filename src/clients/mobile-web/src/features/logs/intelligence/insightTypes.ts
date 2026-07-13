/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * insightTypes — the Insight/TrustLabel dignity contract + the local
 * input shapes for the five pure intelligence-insight functions
 * (Task 1A). See insights.ts for the exact real-data lineage of each
 * field (STEP 0 discovery).
 *
 * These input types intentionally do NOT import the full `DailyLog`
 * graph. Each insight only needs a thin, honest slice of the real
 * persisted fields discovered in STEP 0. Keeping the input types local
 * and minimal:
 *   - keeps this module pure and decoupled from the full domain graph
 *   - makes every field an insight consumes visible at a glance
 *   - prevents an insight from silently depending on a field nobody
 *     verified actually exists on a real persisted log
 *
 * NO React, NO DOM, NO network, NO Dexie, NO AI calls, NO Math.random,
 * NO Date.now(). Pure functions only.
 *
 * spec: dfes-companion-2026-07-11
 */

// =============================================================================
// THE DIGNITY CONTRACT
// =============================================================================

/**
 * TrustLabel — how confident we are in the fact an Insight carries.
 * - 'spoken':    a raw value the farmer stated, shown verbatim.
 * - 'confirmed': a value the farmer explicitly confirmed (e.g. a stage pick).
 * - 'derived':   we computed/aggregated it from other stated values
 *                (a running sum, a day-count, a rate comparison).
 *
 * Mirrors `FieldProvenance` in domain/types/log.types.ts, minus
 * 'assumed' — an insight must NEVER be built on an assumed/fabricated
 * value.
 */
export type TrustLabel = 'spoken' | 'confirmed' | 'derived';

/**
 * Insight — the exact shape every insight function returns.
 *
 * `render=false` is the SAFE DEFAULT. Absence is always safe; a wrong
 * or shaming fact is not. Never bypass this flag "just to show
 * something".
 */
export interface Insight {
    /** Stable id, e.g. 'cost-to-date'. */
    key: string;
    /** false => NEVER shown. */
    render: boolean;
    trustLabel: TrustLabel;
    /** Marathi line, Devanagari numerals via toMarathiNumber. */
    line: string;
}

// =============================================================================
// LOCAL INPUT SHAPES (thin, honest slices of real persisted fields)
// =============================================================================

/**
 * The subset of `CropActivityEvent` (domain/types/log.types.ts) that
 * continuityInsight / daysSinceLastOpInsight actually read.
 * - `title`: the real, open-ended activity-name field (matched against
 *   the caller's `opType`, case-insensitive, exact match).
 * - `quantity`: the real "units completed" field (was `quantityCompleted`).
 */
export interface ContinuityActivityEntry {
    title: string;
    quantity?: number;
}

/**
 * The subset of `DailyLog` (domain/types/log.types.ts) that
 * continuityInsight / daysSinceLastOpInsight read: the real `date`
 * field (YYYY-MM-DD) and the real `cropActivities` array.
 */
export interface FarmerLogEntry {
    date: string;
    cropActivities?: ContinuityActivityEntry[];
}

/**
 * The subset of `DailyLog.financialSummary` (a REQUIRED, always-present
 * field on every real DailyLog — see log.types.ts) that
 * costToDateInsight reads. `totalMachineryCost` already folds in
 * `MachineryEvent.fuelCost` (see `sumMachineryCost` in
 * core/domain/helpers/log-factory-helpers.ts), so summing
 * labour + machinery covers "labour + machinery + fuel" with no extra
 * field needed.
 */
export interface FarmerCostLogEntry {
    financialSummary: {
        totalLabourCost: number;
        totalMachineryCost: number;
    };
}

/**
 * stageInsight's input. Named after the one field in the codebase that
 * actually models a farmer-confirmed crop stage:
 * `StageContext.farmerConfirmedActualStage`
 * (features/logs/services/meterGaps.ts). STEP 0 finding: nothing in the
 * app currently WRITES a value into that field on real farm data (grep
 * shows zero production producers — it is only ever set in test
 * fixtures for meterGaps/dfesStageWindow). This function is built
 * honestly against the field so it is correct the moment a real
 * producer exists; until then it will render=false in production. See
 * phase1a-report.md for detail.
 */
export interface ConfirmedStageEntry {
    confirmedStage?: string;
}

/**
 * rateCheckInsight's input. One "comparable" occurrence of an op: its
 * stated per-unit rate (e.g. `LabourEvent.rate`, the one persisted
 * field in the domain types that is literally already a "rate"), the
 * basis it was expressed in (`LabourEvent.rateBasis`), and whether the
 * log this rate came from resolved to a single, unambiguous plot
 * (`LogScope.mode === 'single'`, derived from `DailyLog.context.selection`
 * — computed by the caller, since scope-resolution is a farm/plot
 * concern, not a rate-comparison concern).
 */
export interface RateCheckEntry {
    rate: number;
    rateBasis: string;
    scopeConfirmed: boolean;
}
