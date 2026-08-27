/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * insights — the five pure intelligence-insight fact functions
 * (Task 1A). Each function computes ONE small, honest, dignity-safe
 * fact from the farmer's own history and returns the `Insight` shape
 * from `insightTypes.ts`. `render=false` is the safe default whenever
 * scope/provenance is unconfirmed or data is insufficient.
 *
 * NO AI calls. NO network. NO cross-farm comparison. NO authority /
 * "recommended" reference — none exists in this product. Pure
 * functions over the farmer's OWN data only.
 *
 * Real-data lineage (STEP 0 discovery — see phase1a-report.md for the
 * full trail; updated for the phase1a-fix-brief.md review-response
 * fixes, spec: dfes-companion-2026-07-11):
 * - continuityInsight / daysSinceLastOpInsight read `DailyLog.date`,
 *   `CropActivityEvent.title` / `.quantity`, AND `.status`
 *   (domain/types/log.types.ts, ~:69) — `status` gates both functions
 *   so a `'pending'` or `'gap_recorded'` activity is never presented as
 *   done work (FIX 1).
 * - costToDateInsight reads `DailyLog.financialSummary.grandTotal` (a
 *   REQUIRED, always-present, already-computed all-in rollup —
 *   labour + input + machinery + activity-expenses — see its usage in
 *   `shared/utils/dayState.ts`), not a partial labour+machinery sum
 *   (FIX 2).
 * - stageInsight reads a farmer-confirmed-stage field shaped like
 *   `StageContext.farmerConfirmedActualStage` (features/logs/services/meterGaps.ts).
 *   STEP 0 finding: nothing in the app currently writes a value into
 *   that field on real data — it is honest, but currently unwired.
 * - rateCheckInsight reads a per-unit rate shaped like
 *   `LabourEvent.rate` / `.rateBasis`, an `opType` (the real activity
 *   `.title` this rate belongs to — FIX 3, so "comparable" priors are
 *   the SAME operation, not just the same rate basis), gated on a
 *   caller-supplied `scopeConfirmed` flag (derived from
 *   `LogScope.mode === 'single'` on `DailyLog.context.selection`).
 *
 * spec: dfes-companion-2026-07-11
 */

import { toMarathiNumber } from '../services/disciplineRecognition';
import type {
    Insight,
    FarmerLogEntry,
    FarmerCostLogEntry,
    ConfirmedStageEntry,
    RateCheckEntry,
    ContinuityActivityEntry,
} from './insightTypes';

// =============================================================================
// SHARED HELPERS
// =============================================================================

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two `YYYY-MM-DD` date keys. Parses both as UTC
 * midnight so the diff is stable regardless of the runtime's local
 * timezone. Pure — a function of its two string args only (no
 * Date.now()).
 */
function daysBetweenDateKeys(fromKey: string, toKey: string): number {
    const from = new Date(`${fromKey}T00:00:00Z`).getTime();
    const to = new Date(`${toKey}T00:00:00Z`).getTime();
    return Math.round((to - from) / MS_PER_DAY);
}

/** Case-insensitive, whitespace-trimmed exact match on activity title. */
function matchesOpType(title: string, opType: string): boolean {
    return title.trim().toLowerCase() === opType.trim().toLowerCase();
}

/**
 * FIX 1 gate for continuityInsight (claims "पूर्ण" — fully complete):
 * count an activity ONLY when it is explicitly `'completed'`, or has no
 * status at all (`undefined` = a legacy log written before `status`
 * existed — no explicit signal either way, so it is treated as
 * recorded-done, not as missing). `'partial'`, `'pending'`, and
 * `'gap_recorded'` are NEVER counted toward a पूर्ण claim.
 */
function isFullyDone(activity: ContinuityActivityEntry): boolean {
    return activity.status === 'completed' || activity.status == null;
}

/**
 * FIX 1 gate for daysSinceLastOpInsight (claims "last time you DID this
 * op"): a `'partial'` occurrence still counts as a valid anchor — the
 * farmer did do it, at least partly. `'pending'` (not yet done) and
 * `'gap_recorded'` (an explicit miss) must NEVER anchor a "you did this"
 * claim.
 */
function wasAttempted(activity: ContinuityActivityEntry): boolean {
    return activity.status === 'completed' || activity.status === 'partial' || activity.status == null;
}

const EMPTY_INSIGHT = (key: string, trustLabel: Insight['trustLabel']): Insight => ({
    key,
    render: false,
    trustLabel,
    line: '',
});

// =============================================================================
// 1. continuityInsight
// =============================================================================

/**
 * continuityInsight — op-type-segregated running count of a repeated
 * activity from the farmer's history. NO denominator, NO "% complete".
 *
 * When at least one matching activity states a `quantity`, the running
 * count is the SUM of those quantities (e.g. total rows pruned so
 * far). When none of them state a quantity, it falls back to an
 * honest occurrence count (number of times the op was logged) — this
 * module never fabricates a unit total that isn't in the data.
 *
 * `unitLabel` is an OPTIONAL caller-supplied Marathi noun (e.g. 'ओळी')
 * for what is being counted. This function does NOT translate the raw
 * `unit` field on `CropActivityEvent` itself — real data holds English
 * strings there (e.g. 'rows', see calibrationFixtures.ts); translating
 * that here would be fabricating copy, not reading real data. The
 * caller (1B), which knows the crop vocabulary in context, supplies
 * the noun.
 *
 * FIX 1 [CRITICAL]: the line says पूर्ण (fully complete), so only
 * activities that are actually done count — `status === 'completed'`
 * or `status == null` (legacy, treated as recorded-done). `'partial'`,
 * `'pending'`, and `'gap_recorded'` are excluded from the count
 * entirely (see `isFullyDone`).
 *
 * render=false when the op has never been logged as fully done.
 */
export function continuityInsight(
    logs: FarmerLogEntry[],
    opType: string,
    unitLabel?: string,
): Insight {
    const key = 'continuity';
    const matches = logs
        .flatMap((log) => log.cropActivities ?? [])
        .filter((activity) => matchesOpType(activity.title, opType))
        .filter(isFullyDone);

    if (matches.length === 0) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    const quantitySum = Math.round(
        matches.reduce((sum, activity) => sum + (activity.quantity ?? 0), 0),
    );
    const done = quantitySum > 0 ? quantitySum : matches.length;
    const doneMr = toMarathiNumber(done);

    const line = unitLabel
        ? `आजपर्यंत ${doneMr} ${unitLabel} पूर्ण.`
        : `आजपर्यंत ${doneMr} वेळा नोंद झाली.`;

    return { key, render: true, trustLabel: 'derived', line };
}

// =============================================================================
// 2. costToDateInsight
// =============================================================================

/**
 * costToDateInsight — season running total of costs the farmer stated,
 * using the real, already-computed `grandTotal` (labour + input +
 * machinery + activity-expenses — see `shared/utils/dayState.ts`).
 * Framed as "what you told me" — never a judgement on the amount.
 * Partial-safe: sums whatever `financialSummary` rollups are present on
 * the logs passed in (the caller is responsible for scoping `logs` to
 * the season it wants totalled — this function itself has no
 * season-boundary concept, since none exists on `DailyLog` directly).
 *
 * FIX 2 [CRITICAL]: previously summed only labour+machinery, silently
 * dropping `totalInputCost` (REQUIRED on every log) and
 * `totalActivityExpenses` — an input-only (e.g. fertilizer) day
 * computed a total of 0 and was hidden entirely, even though the
 * farmer explicitly stated a cost. `grandTotal` is the honest, all-in
 * figure the copy promises.
 *
 * render=false when the summed total is zero (no costs stated).
 */
export function costToDateInsight(logs: FarmerCostLogEntry[]): Insight {
    const key = 'cost-to-date';
    const total = logs.reduce((sum, log) => sum + (log.financialSummary.grandTotal || 0), 0);

    if (total <= 0) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    const amountMr = toMarathiNumber(Math.round(total));
    return {
        key,
        render: true,
        trustLabel: 'derived',
        line: `आतापर्यंत तुम्ही सांगितलेला खर्च ₹${amountMr}.`,
    };
}

// =============================================================================
// 3. daysSinceLastOpInsight
// =============================================================================

/**
 * daysSinceLastOpInsight — whole days since the farmer last did a
 * given op, counted from the most recent log dated STRICTLY BEFORE
 * `referenceDateKey` that contains a matching activity (a batch-recall
 * / routine flavour — "it's been N days since your last X").
 *
 * FIX 1 [CRITICAL]: the anchor activity must be one the farmer actually
 * attempted — `status === 'completed' || status === 'partial' ||
 * status == null` (legacy, treated as recorded-done). `'pending'`
 * (not yet done) and `'gap_recorded'` (an explicit miss) can NEVER
 * anchor a "last time you did this" claim (see `wasAttempted`).
 *
 * render=false when the op has no qualifying prior occurrence before
 * the reference date (including when its only occurrence IS the
 * reference date itself — that is not a "prior").
 */
export function daysSinceLastOpInsight(
    logs: FarmerLogEntry[],
    opType: string,
    referenceDateKey: string,
): Insight {
    const key = 'days-since-last-op';

    const priorDates = logs
        .filter((log) => log.date < referenceDateKey)
        .filter((log) =>
            (log.cropActivities ?? []).some((a) => matchesOpType(a.title, opType) && wasAttempted(a)),
        )
        .map((log) => log.date);

    if (priorDates.length === 0) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    const lastDate = priorDates.reduce((max, d) => (d > max ? d : max));
    const diffDays = daysBetweenDateKeys(lastDate, referenceDateKey);

    if (diffDays < 1) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    return {
        key,
        render: true,
        trustLabel: 'derived',
        line: `शेवटच्या वेळेनंतर ${toMarathiNumber(diffDays)} दिवसांनी.`,
    };
}

// =============================================================================
// 4. stageInsight
// =============================================================================

/**
 * stageInsight — a chip of the CONFIRMED crop stage only. NEVER
 * "should be further along" — this function only ever echoes a stage
 * the farmer already confirmed, verbatim; it never compares against a
 * plan or an expectation.
 *
 * render=false when no stage has been confirmed (absent or
 * blank/whitespace-only).
 */
export function stageInsight(entry: ConfirmedStageEntry): Insight {
    const key = 'stage';
    const stage = entry.confirmedStage?.trim();

    if (!stage) {
        return EMPTY_INSIGHT(key, 'confirmed');
    }

    return {
        key,
        render: true,
        trustLabel: 'confirmed',
        line: `सध्याचा टप्पा — ${stage}.`,
    };
}

// =============================================================================
// 5. rateCheckInsight
// =============================================================================

/**
 * Gentle-question gate: only surfaces when the current rate is >=20%
 * above the farmer's own recent average for comparable entries. This
 * 1.2 multiplier is a KISS default introduced in this module (not a
 * spec-mandated number) — tune here if the founder wants a different
 * gate.
 */
const RATE_CHECK_THRESHOLD_MULTIPLIER = 1.2;

/**
 * rateCheckInsight — this occurrence's per-unit rate vs the farmer's
 * OWN last-N occurrences of the same op (same `rateBasis`, same
 * confirmed single-plot scope). NEVER a verdict, NEVER an external/
 * "recommended" reference — only a gentle question.
 *
 * render ONLY when:
 * 1. `current.scopeConfirmed` is true (the rate is attributable to a
 *    single, unambiguous plot — dividing a cost across an ambiguous
 *    multi-plot scope would produce a meaningless rate).
 * 2. There are >=2 comparable priors: same `rateBasis`, same operation
 *    (`opType`, matched via `matchesOpType` — FIX 3 [IMPORTANT]; without
 *    this, a harvesting rate could be judged against pruning/weeding
 *    priors just because both happened to be quoted `per_acre`), also
 *    scope-confirmed.
 * 3. The current rate is notably higher than the average of those
 *    priors (otherwise the gentle question itself would be a false
 *    "this seems higher" claim — see RATE_CHECK_THRESHOLD_MULTIPLIER).
 */
export function rateCheckInsight(current: RateCheckEntry, priors: RateCheckEntry[]): Insight {
    const key = 'rate-check';

    if (!current.scopeConfirmed) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    const comparable = priors.filter(
        (p) =>
            p.scopeConfirmed &&
            p.rateBasis === current.rateBasis &&
            matchesOpType(p.opType, current.opType),
    );

    if (comparable.length < 2) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    const avgPriorRate = comparable.reduce((sum, p) => sum + p.rate, 0) / comparable.length;

    if (avgPriorRate <= 0 || current.rate < avgPriorRate * RATE_CHECK_THRESHOLD_MULTIPLIER) {
        return EMPTY_INSIGHT(key, 'derived');
    }

    return {
        key,
        render: true,
        trustLabel: 'derived',
        line: 'हे नेहमीपेक्षा जास्त वाटतंय — तपासा?',
    };
}
