/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Understanding Meter Scoring Types
 *
 * Split out of log.types.ts to keep that file under the 800-line cap.
 * Behavior-neutral move; log.types.ts re-exports these for backward compat.
 *
 * Layer: Domain (can only import from other domain types)
 */

import type { FieldProvenance } from './log.types';

// =============================================================================
// UNDERSTANDING METER TYPES (W1.P3 — scoreVlog output)
//
// Defined here (domain layer) so that DailyLog can carry `understanding`
// without a domain→features layering inversion. scoreVlog.ts imports these
// back; the engine (runtime logic) remains in features/logs/services/.
// =============================================================================

/**
 * Re-export alias so scoreVlog.ts can continue using `ProvenanceTag` internally.
 * The canonical name is `FieldProvenance` (defined in log.types.ts).
 * External consumers should prefer `FieldProvenance`.
 */
export type ProvenanceTag = FieldProvenance;

/**
 * ScoreContext — scoring inputs for scoreVlog. All fields optional; safe defaults when absent.
 *
 * DEPENDENCY NOTE: real provenance is W1.P2 (not yet built). When absent,
 * confidenceFactor defaults to a conservative 0.7 (unconfirmed) so the
 * engine runs today and tightens automatically when W1.P2 feeds it.
 */
export interface ScoreContext {
    /** Farm-level info. Solo farm (plotCount=1) waives the SCOPE penalty. */
    farm?: { plotCount: number };
    /**
     * Set of field keys the farmer explicitly confirmed at the confirm-screen.
     * When absent (W1.P2 not yet integrated), confidenceFactor defaults to 0.7.
     */
    confirmedFields?: Set<string> | string[];
    /**
     * Fine-grained per-field provenance map (W1.P2).
     * Keys are dimension identifiers; values are ProvenanceTag.
     * 'assumed' or 'derived' without a confirmedFields entry caps coverage at 0.5.
     */
    provenance?: Record<string, ProvenanceTag>;
    /**
     * Schedule binding for PURPOSE dimension.
     * When absent, PURPOSE is not-applicable (denominator shrinks).
     */
    schedule?: {
        bound: boolean;
        stageFit?: 'fits' | 'off_stage' | 'no_schedule';
    };
    /**
     * Prior continuity progress (0–1). Only used for CONTINUITY dimension.
     * Absent → CONTINUITY not-applicable.
     */
    priorContinuity?: number;
}

/** Per-dimension breakdown row in the scoreVlog output. */
export interface VlogScoreDimension {
    dimension: string;
    applicable: boolean;
    weight: number;
    /** 0 = absent, 0.5 = partial, 1.0 = full */
    coverage: 0 | 0.5 | 1;
    /** [0.7, 1.0] — from confirmed/provenance signals, never from LLM confidence */
    confidenceFactor: number;
    /** weight * coverage * confidenceFactor (0 for not-applicable dimensions) */
    contribution: number;
}

/**
 * VlogScore — the output of scoreVlog.
 * Persisted silently on DailyLog.understanding for tuning; display gated by flag.
 */
export interface VlogScore {
    /**
     * Integer 0–100, or null when outcome is UNKNOWN.
     * Formula: round(100 * Σ_applicable[weight * coverage * confidenceFactor] / Σ_applicable[weight])
     */
    score: number | null;
    /** SCORED = normal day, UNKNOWN = silent/no-work day, DISTURBANCE = blocker day */
    outcome: 'SCORED' | 'UNKNOWN' | 'DISTURBANCE';
    /** Per-dimension breakdown for transparency + debugging. */
    dimensions: VlogScoreDimension[];
}
