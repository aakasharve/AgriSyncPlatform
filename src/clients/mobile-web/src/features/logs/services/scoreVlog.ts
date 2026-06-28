/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * scoreVlog — Understanding Meter Engine (W1.P3.T1, Phase A)
 *
 * Pure, deterministic projection that scores how well the system comprehended
 * a farmer's day. NO network calls, NO AI calls, NO Dexie, NO DB.
 *
 * Flag gate: FEATURE_FLAGS.understandingMeter (default OFF). The ENGINE is
 * always callable; the flag gates the DISPLAY only (see featureFlags.ts).
 *
 * Full ±8 calibration against the 18-vlog golden set is DEFERRED. It requires
 * W1.P2 provenance + a calibration fixture set that does not exist yet.
 * This file proves the LOGIC + direction (rich > sparse, governor, UNKNOWN).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import type { AgriLogResponse, InputEvent, FieldProvenance } from '../../../types';
import {
    computeReceiptTotal,
    sumLabourCost,
    sumInputCost,
    sumMachineryCost,
    sumExpenseCost,
} from '../../../core/domain/helpers/log-factory-helpers';

// =============================================================================
// PROVENANCE DERIVATION (W1.P2 / C-1 fix)
// =============================================================================

/**
 * Honesty order: confirmed > spoken > derived > assumed (most → least honest).
 * Returns a numeric rank so we can compare two tags and keep the least honest.
 * Lower rank = less honest.
 */
function honestyRank(tag: FieldProvenance): number {
    switch (tag) {
        case 'assumed':   return 0;
        case 'derived':   return 1;
        case 'spoken':    return 2;
        case 'confirmed': return 3;
    }
}

/**
 * Reduce a list of optional provenance tags to the least-honest one.
 * Tags that are `undefined` (field absent — no provenance attached) are ignored.
 * Returns `undefined` when the list is empty or all entries are undefined.
 */
function leastHonest(tags: Array<FieldProvenance | undefined>): FieldProvenance | undefined {
    let result: FieldProvenance | undefined;
    for (const tag of tags) {
        if (tag === undefined) continue;
        if (result === undefined || honestyRank(tag) < honestyRank(result)) {
            result = tag;
        }
    }
    return result;
}

/**
 * deriveDimensionProvenance — pure helper (C-1 fix).
 *
 * Reads the per-item `provenance` fields that W1.P2 stamps on each event and
 * maps them to dimension-level provenance using "least-honest wins" so that
 * one fabricated field taints the whole dimension (conservative = honest).
 *
 * Dimension → items it reads:
 *   WHAT      ← cropActivities[].provenance
 *   DOSE      ← inputs[].provenance  +  inputs[].mix[].provenance
 *   CARRIER   ← machinery[].provenance
 *   COST      ← activityExpenses[].provenance + labour[].provenance + machinery[].provenance
 *   WEATHER   ← (no numeric field prone to fabrication — left UNSET)
 *   SCOPE, PURPOSE, CONTINUITY ← left UNSET (no fabrication-prone numeric field)
 *
 * A dimension whose items carry NO provenance key at all → UNSET (not included
 * in the returned map). Never invent a tag.
 *
 * @param log  The AgriLogResponse being scored.
 * @returns    A partial map of dimension → FieldProvenance (only for dimensions
 *             that have at least one provenance-tagged item).
 */
export function deriveDimensionProvenance(log: AgriLogResponse): Record<string, FieldProvenance> {
    const result: Record<string, FieldProvenance> = {};

    // WHAT ← cropActivities[].provenance
    const whatTag = leastHonest(log.cropActivities.map(a => a.provenance));
    if (whatTag !== undefined) result['WHAT'] = whatTag;

    // DOSE ← inputs[].provenance + inputs[].mix[].provenance
    const doseTags: Array<FieldProvenance | undefined> = [
        ...(log.inputs ?? []).map(i => i.provenance),
        ...(log.inputs ?? []).flatMap(i => (i.mix ?? []).map(m => m.provenance)),
    ];
    const doseTag = leastHonest(doseTags);
    if (doseTag !== undefined) result['DOSE'] = doseTag;

    // CARRIER ← machinery[].provenance
    const carrierTag = leastHonest((log.machinery ?? []).map(m => m.provenance));
    if (carrierTag !== undefined) result['CARRIER'] = carrierTag;

    // COST ← activityExpenses[].provenance + labour[].provenance + machinery[].provenance
    const costTags: Array<FieldProvenance | undefined> = [
        ...(log.activityExpenses ?? []).map(e => e.provenance),
        ...(log.labour ?? []).map(l => l.provenance),
        ...(log.machinery ?? []).map(m => m.provenance),
    ];
    const costTag = leastHonest(costTags);
    if (costTag !== undefined) result['COST'] = costTag;

    // WEATHER, SCOPE, PURPOSE, CONTINUITY — intentionally UNSET (no fabrication-prone
    // numeric field; the scoring formula's default factor applies).

    return result;
}

// =============================================================================
// TYPES (public)
// =============================================================================

/**
 * Re-export FieldProvenance under the legacy alias ProvenanceTag so that
 * any local references within this file keep working. External consumers
 * should import `FieldProvenance` directly from `domain/types/log.types`.
 *
 * Single source of truth: `FieldProvenance` is defined in log.types.ts (domain).
 * W1.P2 consolidation — removed the local definition and replaced with import.
 */
export type ProvenanceTag = FieldProvenance;

/**
 * ScoreContext — all fields optional; safe defaults when absent.
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
     * Values are dimension-level identifiers, e.g. 'dose', 'cost', 'carrier'.
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

/** Per-dimension breakdown row in the output. */
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

/** The output of scoreVlog. */
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

// =============================================================================
// INTERNAL CONSTANTS
// =============================================================================

/** Base weights by dimension (sum = 101, intentional: COST 12 + WEATHER 8 etc.
 *  On a blocker day, WEATHER dominates via the multiplier path, not by sum-of-weights). */
const BASE_WEIGHTS: Record<string, number> = {
    WHAT: 20,
    DOSE: 20,
    SCOPE: 12,
    CARRIER: 10,
    COST: 12,
    PURPOSE: 9,
    WEATHER: 8,
    CONTINUITY: 10,
} as const;

/**
 * Default confidenceFactor when no provenance/confirmedFields provided.
 * Conservative — unconfirmed content should not inflate the meter.
 * Tightens automatically when W1.P2 feeds real provenance.
 */
const DEFAULT_CONFIDENCE_FACTOR = 0.7;

/** Confirmed fields get this factor (farmer explicitly reviewed + saved). */
const CONFIRMED_CONFIDENCE_FACTOR = 1.0;

/** Dishonesty governor: fabricated/assumed/unconfirmed values cap coverage. */
const DISHONESTY_CAP = 0.5 as const;

// =============================================================================
// HELPERS
// =============================================================================

/** Resolve the confidence factor for a named dimension from ctx. */
function resolveConfidenceFactor(dimension: string, ctx: ScoreContext): number {
    // Provenance beats confirmedFields when both present.
    if (ctx.provenance) {
        const tag = ctx.provenance[dimension];
        if (tag === 'confirmed' || tag === 'spoken') return CONFIRMED_CONFIDENCE_FACTOR;
        if (tag === 'assumed' || tag === 'derived') return DEFAULT_CONFIDENCE_FACTOR;
        // tag absent: fall through to confirmedFields check
    }
    if (ctx.confirmedFields) {
        const set: Set<string> =
            ctx.confirmedFields instanceof Set
                ? ctx.confirmedFields
                : new Set(ctx.confirmedFields);
        if (set.has(dimension)) return CONFIRMED_CONFIDENCE_FACTOR;
    }
    // No provenance context: conservative default (W1.P2 not yet wired).
    return DEFAULT_CONFIDENCE_FACTOR;
}

/**
 * Dishonesty governor: apply after coverage is derived.
 * If a dimension has provenance=assumed/derived AND is NOT in confirmedFields,
 * its coverage is capped at 0.5.
 */
function applyGovernor(
    dimension: string,
    rawCoverage: 0 | 0.5 | 1,
    ctx: ScoreContext,
): 0 | 0.5 | 1 {
    if (rawCoverage === 0) return 0; // Nothing to cap.
    if (ctx.provenance) {
        const tag = ctx.provenance[dimension];
        if (tag === 'assumed' || tag === 'derived') {
            // Check if the farmer confirmed it despite the assumed provenance.
            const confirmed =
                ctx.confirmedFields instanceof Set
                    ? ctx.confirmedFields.has(dimension)
                    : Array.isArray(ctx.confirmedFields) && ctx.confirmedFields.includes(dimension);
            if (!confirmed) {
                // Cap at dishonesty ceiling.
                return rawCoverage > DISHONESTY_CAP ? DISHONESTY_CAP : rawCoverage;
            }
        }
    }
    return rawCoverage;
}

/** Build a single dimension row. */
function makeDim(
    dimension: string,
    applicable: boolean,
    rawCoverage: 0 | 0.5 | 1,
    ctx: ScoreContext,
): VlogScoreDimension {
    const weight = BASE_WEIGHTS[dimension] ?? 0;
    if (!applicable) {
        return { dimension, applicable: false, weight, coverage: 0, confidenceFactor: DEFAULT_CONFIDENCE_FACTOR, contribution: 0 };
    }
    const coverage = applyGovernor(dimension, rawCoverage, ctx);
    const confidenceFactor = resolveConfidenceFactor(dimension, ctx);
    const contribution = weight * coverage * confidenceFactor;
    return { dimension, applicable: true, weight, coverage, confidenceFactor, contribution };
}

// =============================================================================
// DIMENSION COVERAGE RULES (documented, simple, verifiable)
// =============================================================================

/**
 * WHAT (weight 20): Was work captured?
 * - 0: no cropActivities AND no summary AND no disturbance reason (nothing captured)
 * - 0.5: only summary text, no cropActivities events populated
 * - 1.0: at least one cropActivity with a non-empty title present,
 *         OR a disturbance with a non-empty reason (the disturbance IS the day's event)
 *
 * Rationale: cropActivities are the primary work spine. A summary alone is
 * partial — text captured but not structured. An activity event with a title
 * is full capture. A disturbance with a recorded reason is equally full capture:
 * the farmer told us what happened (a blocker), which IS the day's news.
 */
function scoreWHAT(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    const hasActivity = log.cropActivities.length > 0
        && log.cropActivities.some(a => a.title && a.title.trim().length > 0);
    // Tuning (1b): a disturbance with a non-empty reason is full WHAT coverage —
    // the farmer told us exactly what happened (the disruption), which IS the event.
    const hasDisturbanceReason = !!(log.disturbance?.reason && log.disturbance.reason.trim().length > 0);
    const hasSummary = log.summary && log.summary.trim().length > 0;

    let coverage: 0 | 0.5 | 1;
    if (hasActivity || hasDisturbanceReason) coverage = 1;
    else if (hasSummary) coverage = 0.5;
    else coverage = 0;

    return makeDim('WHAT', true, coverage, ctx);
}

/**
 * DOSE (weight 20): Input-ops only — product + quantity/grade present.
 * - NOT-APPLICABLE when there are no input events (non-input op day).
 * - 0: no input events with any product name
 * - 0.5: product present but no dose/quantity/unit on any mix item
 * - 1.0: at least one input with product AND dose/quantity present on a mix item
 *
 * Rationale: The core question is "did the farmer tell us what they applied
 * and at what rate?" Product name is required; dose/unit on a mix item
 * is the "grade" signal.
 */
function scoreDOSE(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    const inputs: InputEvent[] = log.inputs ?? [];
    if (inputs.length === 0) {
        return makeDim('DOSE', false, 0, ctx); // Not applicable
    }

    const hasProduct = inputs.some(
        i => (i.productName && i.productName.trim().length > 0)
            || (i.mix && i.mix.some(m => m.productName && m.productName.trim().length > 0))
    );
    if (!hasProduct) return makeDim('DOSE', true, 0, ctx);

    const hasDose = inputs.some(
        i => i.mix && i.mix.some(m => m.dose !== undefined && m.dose !== null)
    );
    const coverage: 0 | 0.5 | 1 = hasDose ? 1 : 0.5;
    return makeDim('DOSE', true, coverage, ctx);
}

/**
 * SCOPE (weight 12): Target plot named.
 * - Solo-farm waiver: if farm.plotCount === 1, full score regardless.
 * - Full-day disturbance waiver: if disturbance.scope === 'FULL_DAY', the scope
 *   is definitionally known (the whole farm was affected) → full score.
 * - 0: multi-plot farm, no events have targetPlotName (and no FULL_DAY disturbance)
 * - 0.5: some events have targetPlotName, others do not
 * - 1.0: all events carry targetPlotName, OR solo farm, OR FULL_DAY disturbance
 *
 * Rationale: On a multi-plot farm, knowing which plot the work happened on
 * is critical for per-plot cost and decision-making. Solo farm = implicit.
 * A FULL_DAY disturbance affects the whole farm — scope is 100% known.
 */
function scoreSCOPE(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    const plotCount = ctx.farm?.plotCount ?? 1;
    if (plotCount <= 1) {
        return makeDim('SCOPE', true, 1, ctx); // Solo-farm waiver
    }

    // Tuning (1b): FULL_DAY disturbance = we know the scope perfectly (whole farm blocked).
    if (log.disturbance?.scope === 'FULL_DAY') {
        return makeDim('SCOPE', true, 1, ctx);
    }

    // Collect events that can carry targetPlotName
    const allEvents = [
        ...log.cropActivities,
        ...log.inputs,
        ...log.labour,
        ...log.machinery,
        ...(log.activityExpenses ?? []),
    ];

    if (allEvents.length === 0) return makeDim('SCOPE', true, 0, ctx);

    const named = allEvents.filter(e => {
        const ev = e as { targetPlotName?: string };
        return ev.targetPlotName && ev.targetPlotName.trim().length > 0;
    });

    if (named.length === 0) return makeDim('SCOPE', true, 0, ctx);
    if (named.length === allEvents.length) return makeDim('SCOPE', true, 1, ctx);
    return makeDim('SCOPE', true, 0.5, ctx);
}

/**
 * CARRIER (weight 10): Spray carrier vol/machine config; re-skins to
 * irrigation duration+method+source for pure irrigation ops.
 *
 * Pure irrigation op: inputs.length === 0 && irrigation.length > 0.
 *   - 0: no irrigation events, or all have method='unknown'/empty
 *   - 0.5: method present, no duration or source
 *   - 1.0: method + durationHours (or waterVolumeLitres) + source all present
 *
 * Spray op (inputs present):
 *   - 0: no inputs have carrierCount or computedWaterVolume
 *   - 0.5: carrierType or carrierCount present, but not both + no volume
 *   - 1.0: carrierCount + carrierType (or computedWaterVolume) present on any input
 *
 * Rationale: Carrier is about "how was it delivered" — volume + machine context.
 */
function scoreCARRIER(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    const inputs: InputEvent[] = log.inputs ?? [];
    const irrigations = log.irrigation ?? [];

    const isPureIrrigation = inputs.length === 0 && irrigations.length > 0;

    if (isPureIrrigation) {
        const hasMethod = irrigations.some(i => i.method && i.method.trim().length > 0 && i.method !== 'unknown');
        if (!hasMethod) return makeDim('CARRIER', true, 0, ctx);
        const hasDuration = irrigations.some(i => i.durationHours !== undefined && i.durationHours !== null);
        const hasSource = irrigations.some(i => i.source && i.source.trim().length > 0);
        const coverage: 0 | 0.5 | 1 = (hasDuration || irrigations.some(i => i.waterVolumeLitres !== undefined)) && hasSource ? 1 : 0.5;
        return makeDim('CARRIER', true, coverage, ctx);
    }

    // Spray/input ops
    if (inputs.length === 0) {
        // No inputs, no irrigation → CARRIER not applicable (nothing to deliver).
        // Tuning (1b): on a day with no inputs AND no irrigation, the carrier
        // question is not relevant — mark it N/A so it doesn't penalise the
        // denominator for days that simply aren't delivery operations.
        return makeDim('CARRIER', false, 0, ctx);
    }

    const hasVolume = inputs.some(i => i.computedWaterVolume !== undefined && i.computedWaterVolume !== null);
    const hasCarrierCount = inputs.some(i => i.carrierCount !== undefined && i.carrierCount !== null);
    const hasCarrierType = inputs.some(i => i.carrierType && i.carrierType.trim().length > 0);

    if (hasVolume || (hasCarrierCount && hasCarrierType)) {
        return makeDim('CARRIER', true, 1, ctx);
    }
    if (hasCarrierCount || hasCarrierType) {
        return makeDim('CARRIER', true, 0.5, ctx);
    }
    return makeDim('CARRIER', true, 0, ctx);
}

/**
 * COST (weight 12, up to ~22 on labour-heavy days per spec design):
 * Labour cost + rates present; uses computeReceiptTotal for the cost basis.
 *
 * - 0: no cost data at all AND no wage rate stated on any labour event
 * - 0.5: labour has a stated wage rate (wagePerPerson) but no computable total
 *         (e.g. piece-rate where total = rate × units_not_stated), OR a total
 *         is present but no rate breakdown when labour events exist
 * - 1.0: cost total > 0 AND (no labour OR labour has wagePerPerson/totalCost set)
 *
 * Rationale: A meaningful cost record has a non-zero total AND labour
 * breakdown if labour was the main cost driver. For piece-rate labour where
 * the farmer stated the rate ("Rs 14/vine") but the total is uncomputable
 * (vine count not stated), the rate alone counts as partial (0.5) — the cost
 * signal exists even though we cannot sum it. This is honest: rate is spoken,
 * total is NOT_MENTIONED.
 */
function scoreCOST(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    const labourCost = sumLabourCost(log.labour ?? []);
    const inputCost = sumInputCost(log.inputs ?? []);
    const machineCost = sumMachineryCost(log.machinery ?? []);
    const expenseCost = sumExpenseCost(log.activityExpenses ?? []);
    const total = computeReceiptTotal({ labourCost, inputCost, machineCost, expenseCost });

    // Tuning (1b): check labour rate BEFORE checking total=0.
    // A spoken piece-rate (wagePerPerson set) is partial coverage even when
    // the computable total is 0 (total = rate × unstated unit count).
    const hasLabour = (log.labour ?? []).length > 0;
    if (hasLabour) {
        const hasRate = (log.labour ?? []).some(
            l => (l.wagePerPerson !== undefined && l.wagePerPerson !== null)
                || (l.totalCost !== undefined && l.totalCost !== null && l.totalCost > 0)
        );
        if (total > 0 && hasRate) return makeDim('COST', true, 1, ctx);
        if (hasRate) return makeDim('COST', true, 0.5, ctx); // Rate spoken, total not computable
        if (total > 0) return makeDim('COST', true, 0.5, ctx); // Total known but no rate breakdown
        return makeDim('COST', true, 0, ctx);
    }

    if (total === 0) return makeDim('COST', true, 0, ctx);
    return makeDim('COST', true, 1, ctx);
}

/**
 * PURPOSE (weight 9): Schedule/intent bound.
 * NOT-APPLICABLE when no schedule is bound (ctx.schedule absent or bound=false).
 *
 * - 0: schedule bound but the activity is completely off-stage
 * - 0.5: schedule bound, stage fit unknown or partial
 * - 1.0: schedule bound + stageFit='fits'
 *
 * Rationale: Knowing WHY an activity was done today (schedule alignment)
 * adds intent context. Without a schedule, this question is unanswerable.
 */
function scorePURPOSE(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    // Suppress unused warning: log is part of the consistent signature
    void log;

    if (!ctx.schedule || !ctx.schedule.bound) {
        return makeDim('PURPOSE', false, 0, ctx); // Not applicable
    }

    const stageFit = ctx.schedule.stageFit;
    let coverage: 0 | 0.5 | 1;
    if (stageFit === 'fits') coverage = 1;
    else if (stageFit === 'off_stage') coverage = 0;
    else coverage = 0.5; // no_schedule or undefined → partial

    return makeDim('PURPOSE', true, coverage, ctx);
}

/**
 * WEATHER (weight 8, DOMINANT ~60% weight on a blocker/disturbance day):
 * Weather captured and/or disturbance recorded.
 *
 * On a DISTURBANCE_RECORDED day, WEATHER becomes the primary signal.
 * The weight inflation is handled at the formula level by scaling the weight.
 *
 * - 0: no weather data, no disturbance
 * - 0.5: disturbance recorded but no specific weather event type, OR
 *         weatherStamp present but no event type
 * - 1.0: weather event type captured (or disturbance with a clear weather reason)
 *
 * Rationale: The farmer's day is shaped by weather; capturing it contextualises
 * why things were done (or not done).
 */
function scoreWEATHER(
    log: AgriLogResponse,
    ctx: ScoreContext,
    effectiveWeight: number,
): VlogScoreDimension {
    void ctx;
    const hasDisturbance = !!log.disturbance;
    const disturbanceReason = log.disturbance?.reason;
    const hasWeatherReason = hasDisturbance && disturbanceReason && disturbanceReason.trim().length > 0;

    // We don't have direct weatherStamp on AgriLogResponse (it's on DailyLog),
    // so we infer from disturbance + observations referencing weather.
    const weatherObservation = (log.observations ?? []).some(
        o => (o.tags ?? []).some((t: string) => t.toLowerCase().includes('weather') || t.toLowerCase().includes('rain') || t.toLowerCase().includes('wind'))
    );

    let coverage: 0 | 0.5 | 1;
    if (hasWeatherReason || weatherObservation) coverage = 1;
    else if (hasDisturbance) coverage = 0.5;
    else coverage = 0;

    const weight = BASE_WEIGHTS['WEATHER'] ?? 8;
    const usedWeight = effectiveWeight !== weight ? effectiveWeight : weight;

    const rawCoverage = coverage;
    const finalCoverage = applyGovernor('WEATHER', rawCoverage, ctx);
    const confidenceFactor = resolveConfidenceFactor('WEATHER', ctx);
    const contribution = usedWeight * finalCoverage * confidenceFactor;

    return {
        dimension: 'WEATHER',
        applicable: true,
        weight: usedWeight,
        coverage: finalCoverage,
        confidenceFactor,
        contribution,
    };
}

/**
 * CONTINUITY (weight 10): Incremental ops only.
 * NOT-APPLICABLE when ctx.priorContinuity is absent (not an incremental op).
 *
 * - 0: no progress data (priorContinuity=0 and no quantity on any activity)
 * - 0.5: some progress but quantity/unit missing from activities
 * - 1.0: activities have quantity+unit AND priorContinuity > 0 (running progress)
 *
 * Rationale: Multi-session operations (e.g. pruning rows over days) need
 * running progress captured to track completion.
 */
function scoreCONTINUITY(log: AgriLogResponse, ctx: ScoreContext): VlogScoreDimension {
    if (ctx.priorContinuity === undefined || ctx.priorContinuity === null) {
        return makeDim('CONTINUITY', false, 0, ctx); // Not applicable
    }

    const activitiesWithQty = log.cropActivities.filter(
        a => a.quantity !== undefined && a.quantity !== null && a.unit && a.unit.trim().length > 0
    );

    let coverage: 0 | 0.5 | 1;
    if (ctx.priorContinuity > 0 && activitiesWithQty.length > 0) coverage = 1;
    else if (activitiesWithQty.length > 0 || ctx.priorContinuity > 0) coverage = 0.5;
    else coverage = 0;

    return makeDim('CONTINUITY', true, coverage, ctx);
}

// =============================================================================
// SILENCE / DISTURBANCE DETECTION
// =============================================================================

/**
 * A day is SILENT (→ UNKNOWN) when:
 * - dayOutcome is NO_WORK_PLANNED or IRRELEVANT_INPUT, AND
 * - all work buckets are empty.
 *
 * A DISTURBANCE day is NOT silent — it scores, with WEATHER dominant.
 */
function isSilentDay(log: AgriLogResponse): boolean {
    if (log.dayOutcome === 'DISTURBANCE_RECORDED') return false;
    if (log.dayOutcome === 'WORK_RECORDED') return false;

    const hasAnyWork =
        log.cropActivities.length > 0
        || log.inputs.length > 0
        || log.labour.length > 0
        || log.machinery.length > 0
        || (log.irrigation ?? []).length > 0
        || (log.activityExpenses ?? []).length > 0;

    return !hasAnyWork;
}

// =============================================================================
// MAIN ENGINE
// =============================================================================

/**
 * scoreVlog — Understanding Meter core engine.
 *
 * Pure function: no side effects, no network, no AI, no Dexie.
 * Flag gate for display: FEATURE_FLAGS.understandingMeter (default OFF).
 *
 * @param log  The AgriLogResponse from the voice-parse pipeline.
 * @param ctx  Optional scoring context (provenance, farm, schedule, etc.).
 *             All fields have safe defaults when absent.
 * @returns    VlogScore with integer score (0–100), outcome, and per-dimension breakdown.
 */
export function scoreVlog(log: AgriLogResponse, ctx: ScoreContext = {}): VlogScore {
    // --- C-1 fix: derive effective provenance from log items when not explicitly supplied ---
    // An explicit ctx.provenance overrides (test/back-compat path). When absent,
    // we derive it from the per-item provenance tags W1.P2 stamps on the log so
    // that the dishonesty governor + confidenceFactor fire from real data.
    const effectiveCtx: ScoreContext = ctx.provenance
        ? ctx
        : { ...ctx, provenance: deriveDimensionProvenance(log) };

    // --- Silent day → UNKNOWN sentinel (NOT 0) ---
    if (isSilentDay(log)) {
        const dimensions = Object.keys(BASE_WEIGHTS).map(dim =>
            makeDim(dim, false, 0, effectiveCtx)
        );
        return { score: null, outcome: 'UNKNOWN', dimensions };
    }

    // --- Determine if this is a blocker/disturbance day ---
    const isDisturbanceDay = log.dayOutcome === 'DISTURBANCE_RECORDED';

    // --- Compute WEATHER weight (dominant on disturbance day: ~60% effective) ---
    // On a disturbance day the denominator collapses to mostly WEATHER + WHAT.
    // We achieve the ~60% dominance by scaling WEATHER weight to 48 (out of ~80 total),
    // then it naturally floats to ~60%. The spec says "dominant ~60% weight" — we
    // implement this as a 6× multiplier on the base weight.
    const weatherWeight = isDisturbanceDay ? (BASE_WEIGHTS['WEATHER'] ?? 8) * 6 : (BASE_WEIGHTS['WEATHER'] ?? 8);

    // --- Build dimension rows ---
    const dimensions: VlogScoreDimension[] = [
        scoreWHAT(log, effectiveCtx),
        scoreDOSE(log, effectiveCtx),
        scoreSCOPE(log, effectiveCtx),
        scoreCARRIER(log, effectiveCtx),
        scoreCOST(log, effectiveCtx),
        scorePURPOSE(log, effectiveCtx),
        scoreWEATHER(log, effectiveCtx, weatherWeight),
        scoreCONTINUITY(log, effectiveCtx),
    ];

    // --- Formula: Σ_applicable[weight * coverage * cf] / Σ_applicable[weight] ---
    let weightedSum = 0;
    let applicableWeightSum = 0;

    for (const dim of dimensions) {
        if (dim.applicable) {
            weightedSum += dim.contribution;
            applicableWeightSum += dim.weight;
        }
    }

    const rawScore = applicableWeightSum > 0
        ? (100 * weightedSum) / applicableWeightSum
        : 0;

    const score = Math.round(rawScore);

    return {
        score,
        outcome: isDisturbanceDay ? 'DISTURBANCE' : 'SCORED',
        dimensions,
    };
}
