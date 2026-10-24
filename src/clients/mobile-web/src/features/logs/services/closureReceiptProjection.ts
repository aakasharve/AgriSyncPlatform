/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * closureReceiptProjection — Track C "closure receipt" projection (WP-4, Task 10)
 *
 * Pure, deterministic projection of a saved DailyLog into the shape a
 * ClosureReceiptCard renders. NO React, NO network, NO Dexie, NO styling.
 *
 * Reuses the shared derivations rather than re-deriving:
 *   - deriveVisibleBucketsFromParseResult (previously DEAD — this flips it LIVE)
 *   - buildWorkDoneProjection (the human-readable "work done" rows)
 *
 * The DISPLAY is gated by FEATURE_FLAGS.understandingMeter (OFF). This module is
 * logic only; the visual treatment is DEFERRED to founder art assets
 * (build-infra-now-defer-ui-polish-until-assets).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { AgriLogResponse, DailyLog } from '../../../types';
import type { VlogScore } from '../../../domain/types/log.types';
import type { WeatherStamp } from '../../../domain/types/weather.types';
import type { VisibleBucketId } from '../../../domain/ai/BucketId';
import { deriveVisibleBucketsFromParseResult } from './bucketDerivation';
import { buildWorkDoneProjection, type WorkDoneProjectionItem } from './workDoneProjection';
import {
    computeReceiptTotal,
    sumLabourCost,
    sumInputCost,
    sumMachineryCost,
    sumExpenseCost,
} from '../../../core/domain/helpers/log-factory-helpers';

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/** Cost totals surfaced on the receipt (mirrors DailyLog.financialSummary). */
export interface ClosureReceiptTotals {
    totalLabourCost: number;
    totalInputCost: number;
    totalMachineryCost: number;
    totalActivityExpenses: number;
    grandTotal: number;
}

/** The projection a ClosureReceiptCard renders. */
export interface ClosureReceipt {
    /** Visible bucket badges (from the shared, now-LIVE derivation). */
    buckets: VisibleBucketId[];
    /** Human-readable "work done" rows. */
    workDone: WorkDoneProjectionItem[];
    /** Cost totals — from financialSummary when present, else summed from events. */
    totals: ClosureReceiptTotals;
    /** The weather stamp on the log, if any. */
    weather?: WeatherStamp;
    /** The understanding VlogScore stamped on the log, if any. */
    score?: VlogScore;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Adapt a DailyLog to the AgriLogResponse shape the shared bucket derivation
 * consumes. The derivation only reads the event arrays + disturbance +
 * plannedTasks + observations; the extra AgriLogResponse fields are inert
 * placeholders so we do not fork the derivation logic.
 */
function asParseResult(log: DailyLog): AgriLogResponse {
    return {
        summary: '',
        // task-0b — `log.dayOutcome` is `DayOutcome | null`; `AgriLogResponse
        // .dayOutcome` is unchanged and still required, so this falls back
        // exactly as this projection already did for every pulled log before
        // task-0b.
        dayOutcome: log.dayOutcome ?? 'WORK_RECORDED',
        cropActivities: log.cropActivities ?? [],
        irrigation: log.irrigation ?? [],
        labour: log.labour ?? [],
        inputs: log.inputs ?? [],
        machinery: log.machinery ?? [],
        activityExpenses: log.activityExpenses ?? [],
        observations: log.observations,
        plannedTasks: log.plannedTasks?.map(t => ({
            title: t.title,
            category: 'general' as const,
            sourceText: t.sourceText ?? '',
            systemInterpretation: t.systemInterpretation ?? '',
        })),
        disturbance: log.disturbance,
        missingSegments: [],
    };
}

/**
 * Resolve cost totals. Prefer the log's own financialSummary (the confirmed
 * numbers); fall back to summing the event costs so the receipt is never blank
 * on an older log that predates financialSummary.
 */
function resolveTotals(log: DailyLog): ClosureReceiptTotals {
    const fs = log.financialSummary;
    if (fs) {
        return {
            totalLabourCost: fs.totalLabourCost,
            totalInputCost: fs.totalInputCost,
            totalMachineryCost: fs.totalMachineryCost,
            totalActivityExpenses: fs.totalActivityExpenses ?? 0,
            grandTotal: fs.grandTotal,
        };
    }

    const totalLabourCost = sumLabourCost(log.labour ?? []);
    const totalInputCost = sumInputCost(log.inputs ?? []);
    const totalMachineryCost = sumMachineryCost(log.machinery ?? []);
    const totalActivityExpenses = sumExpenseCost(log.activityExpenses ?? []);
    return {
        totalLabourCost,
        totalInputCost,
        totalMachineryCost,
        totalActivityExpenses,
        grandTotal: computeReceiptTotal({
            labourCost: totalLabourCost,
            inputCost: totalInputCost,
            machineCost: totalMachineryCost,
            expenseCost: totalActivityExpenses,
        }),
    };
}

// =============================================================================
// MAIN PROJECTION
// =============================================================================

/**
 * buildClosureReceipt — project a saved DailyLog into the closure-receipt shape.
 *
 * @param log  A saved DailyLog (from history).
 * @returns    ClosureReceipt: buckets, workDone rows, totals, weather, score.
 */
export function buildClosureReceipt(log: DailyLog): ClosureReceipt {
    const parseResult = asParseResult(log);
    return {
        buckets: deriveVisibleBucketsFromParseResult(parseResult),
        workDone: buildWorkDoneProjection(parseResult),
        totals: resolveTotals(log),
        weather: log.weatherStamp,
        score: log.understanding,
    };
}
