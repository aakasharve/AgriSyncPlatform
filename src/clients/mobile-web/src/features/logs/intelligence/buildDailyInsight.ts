/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * buildDailyInsight — Task 1B pure `DailyLog[]` -> Task 1A insight-input
 * mapping (spec: dfes-companion-2026-07-11). This is the ONLY place that
 * maps the real, persisted `DailyLog` graph onto the thin, honest input
 * shapes the five Task 1A insight functions read (`insightTypes.ts`) — the
 * 1A module itself is NOT modified.
 *
 * Real-data lineage (domain/types/log.types.ts):
 * - continuity / days-since / unitLabel: `DailyLog.date`,
 *   `CropActivityEvent.title` / `.quantity` / `.status` / `.unit` (~65-79).
 * - cost: `DailyLog.financialSummary.grandTotal` (REQUIRED, ~676-682).
 * - rate-check: `LabourEvent.activity` (the real field a labour entry names
 *   its op with — see `features/logs/services/workDoneProjection.ts:131`,
 *   `labour.activity || 'Labour work done'`), `.rate` / `.rateBasis`
 *   (~164-165), and `DailyLog.context.selection[].selectedPlotIds`
 *   (`FarmContext`, ~777-779) to derive `scopeConfirmed` (a single,
 *   unambiguous plot — mirrors `LogScope.mode === 'single'`, computed here
 *   directly from `context.selection` rather than constructing a full
 *   `LogScope`, since only the single-plot fact is needed).
 * - stage: NO `DailyLog` field carries a farmer-confirmed stage today.
 *   `StageContext.farmerConfirmedActualStage` (meterGaps.ts) is a
 *   standalone parameter built elsewhere (dfesQuestionEngine), never
 *   persisted onto a `DailyLog` — grep confirms zero production
 *   producers. Wired honestly as `{ confirmedStage: undefined }` so
 *   `stageInsight` renders false until a real producer exists (expected,
 *   see phase1a-report.md).
 *
 * Assumes `savedLog` (when present) is an element of `history` — this
 * matches the real caller contract in `core/navigation/mainView.tsx`,
 * where `savedLog` is looked up via `history.find(l => l.id === savedLogId)`.
 * `history` alone is therefore the complete log set; `savedLog` is only
 * consulted separately for (a) the "what op did they just log" context and
 * (b) excluding today's own rate from its own "prior average" comparison.
 *
 * PURE: no React, DOM, Dexie, network, Math.random, or Date.now(). The
 * caller supplies `todayDate` explicitly.
 */

import type { DailyLog, CropActivityEvent, LabourEvent } from '../../../domain/types/log.types';
import {
    continuityInsight,
    costToDateInsight,
    daysSinceLastOpInsight,
    stageInsight,
    rateCheckInsight,
} from './insights';
import { pickDailyInsight } from './pickDailyInsight';
import type {
    Insight,
    FarmerLogEntry,
    FarmerCostLogEntry,
    RateCheckEntry,
} from './insightTypes';

/**
 * Case-insensitive, whitespace-trimmed exact match — mirrors the private
 * `matchesOpType` in `insights.ts` (not exported, and that module is not
 * modified here) so this selector's own opType-scoped lookups (unitLabel,
 * rate-check) apply the identical matching rule the 1A functions use
 * internally.
 */
function sameOpType(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Mirrors the private `isFullyDone` gate in `insights.ts` (FIX 1): only an
 * activity that is explicitly `'completed'`, or carries no status at all
 * (legacy, treated as recorded-done), counts as "matched, done work" — used
 * here to decide which activities' `unit` may honestly inform `unitLabel`.
 */
function isFullyDone(activity: CropActivityEvent): boolean {
    return activity.status === 'completed' || activity.status == null;
}

/**
 * Maps `DailyLog[]` -> the thin `FarmerLogEntry[]` shape continuity /
 * days-since read.
 */
function toFarmerLogEntries(history: DailyLog[]): FarmerLogEntry[] {
    return history.map((log) => ({
        date: log.date,
        cropActivities: (log.cropActivities ?? []).map((activity) => ({
            title: activity.title,
            quantity: activity.quantity,
            status: activity.status,
        })),
    }));
}

/** Maps `DailyLog[]` -> the thin `FarmerCostLogEntry[]` shape costToDateInsight reads. */
function toFarmerCostLogEntries(history: DailyLog[]): FarmerCostLogEntry[] {
    return history.map((log) => ({
        financialSummary: { grandTotal: log.financialSummary.grandTotal },
    }));
}

/**
 * The op the farmer just logged: the FIRST non-blank
 * `cropActivities[].title` on `savedLog` (the real, open-ended
 * activity-name field). Most real submissions carry one op per save (see
 * `buildCropActivities`, `features/logs/services/logSubmissionService.ts`);
 * on a multi-activity save this honestly reads the first one rather than
 * fabricating a "primary" via a heuristic no real data backs.
 *
 * Returns `undefined` when no title is derivable — callers MUST then skip
 * continuity / days-since / rate-check (carry-note N2: never call them
 * with an empty opType string).
 */
function derivePrimaryOpType(savedLog: DailyLog | undefined): string | undefined {
    if (!savedLog) {
        return undefined;
    }
    return (savedLog.cropActivities ?? [])
        .map((activity) => activity.title?.trim())
        .find((title): title is string => !!title);
}

/**
 * unitLabel (carry-note N1): the real `unit` field on `CropActivityEvent`
 * read verbatim (English strings like 'rows' are real persisted data — see
 * `services/__tests__/calibrationFixtures.ts:186` — not something this
 * selector may translate into Marathi; that would be fabricating copy, not
 * reading real data, per `continuityInsight`'s own doc in `insights.ts`).
 *
 * Only returned when every "matched" activity (same opType, fully done —
 * the same set `continuityInsight` itself pools) that states a unit agrees
 * on that unit. Returns `undefined` (no unitLabel) when: no matched
 * activity states a unit; matched activities disagree; or an activity
 * states a quantity but no unit — continuityInsight then falls back to its
 * own honest occurrence-count wording.
 */
function deriveUnitLabel(history: DailyLog[], opType: string): string | undefined {
    const units = new Set(
        history
            .flatMap((log) => log.cropActivities ?? [])
            .filter((activity) => sameOpType(activity.title, opType) && isFullyDone(activity))
            .map((activity) => activity.unit?.trim())
            .filter((unit): unit is string => !!unit),
    );
    return units.size === 1 ? [...units][0] : undefined;
}

/**
 * scopeConfirmed: the log resolved to a single, unambiguous plot. Derived
 * directly from `DailyLog.context.selection` (`FarmContext`,
 * log.types.ts ~777-779) — the same fact `LogScope.mode === 'single'`
 * encodes, computed locally rather than constructing a full `LogScope`
 * (this selector only needs the single-plot boolean).
 */
function isSinglePlotScope(log: DailyLog): boolean {
    const plotIds = (log.context?.selection ?? []).flatMap((selection) => selection.selectedPlotIds ?? []);
    return plotIds.length === 1;
}

/** A labour entry with the fields rate-check needs cleanly present. */
type ComparableLabourEvent = LabourEvent & { activity: string; rate: number; rateBasis: string };

function isComparableForOp(labour: LabourEvent, opType: string): labour is ComparableLabourEvent {
    return (
        typeof labour.activity === 'string' &&
        sameOpType(labour.activity, opType) &&
        typeof labour.rate === 'number' &&
        typeof labour.rateBasis === 'string'
    );
}

/**
 * The current occurrence's rate-check entry, derived from `savedLog`'s OWN
 * labour rate for `opType`. `undefined` (skip rate-check entirely) unless
 * a matching labour entry cleanly states BOTH `rate` and `rateBasis` — this
 * selector never fabricates a rate the farmer didn't state.
 */
function deriveRateCheckCurrent(savedLog: DailyLog | undefined, opType: string): RateCheckEntry | undefined {
    if (!savedLog) {
        return undefined;
    }
    const match = (savedLog.labour ?? []).find((labour) => isComparableForOp(labour, opType));
    if (!match) {
        return undefined;
    }
    return {
        rate: match.rate,
        rateBasis: match.rateBasis,
        scopeConfirmed: isSinglePlotScope(savedLog),
        opType,
    };
}

/**
 * Prior rate-check entries: same-op labour rates from `history`, EXCLUDING
 * `savedLog` itself (so today's own rate never inflates its own "recent
 * average" comparison).
 */
function deriveRateCheckPriors(history: DailyLog[], savedLog: DailyLog | undefined, opType: string): RateCheckEntry[] {
    const priorLogs = savedLog ? history.filter((log) => log.id !== savedLog.id) : history;
    return priorLogs.flatMap((log) => {
        const scopeConfirmed = isSinglePlotScope(log);
        return (log.labour ?? [])
            .filter((labour): labour is ComparableLabourEvent => isComparableForOp(labour, opType))
            .map((labour) => ({
                rate: labour.rate,
                rateBasis: labour.rateBasis,
                scopeConfirmed,
                opType,
            }));
    });
}

/**
 * buildDailyInsight — build every applicable Insight from the farmer's real
 * history + today's saved log, then hand the candidate set to
 * `pickDailyInsight` for the deterministic daily rotation.
 *
 * @param history    All of the farmer's logs (assumed to already include
 *                   `savedLog`, per the real mainView.tsx caller contract).
 * @param savedLog   Today's just-saved log (the op the farmer just logged);
 *                   `undefined` when not resolvable.
 * @param todayDate  'YYYY-MM-DD' — the real local date, used both as the
 *                   days-since reference date and the daily-rotation key.
 */
export function buildDailyInsight(
    history: DailyLog[],
    savedLog: DailyLog | undefined,
    todayDate: string,
): Insight | null {
    const farmerLogEntries = toFarmerLogEntries(history);
    const opType = derivePrimaryOpType(savedLog);

    const insights: Insight[] = [
        costToDateInsight(toFarmerCostLogEntries(history)),
        // No DailyLog field carries a farmer-confirmed stage today (see
        // module doc above) — wired honestly; renders false until a real
        // producer exists.
        stageInsight({ confirmedStage: undefined }),
    ];

    if (opType) {
        const unitLabel = deriveUnitLabel(history, opType);
        insights.push(continuityInsight(farmerLogEntries, opType, unitLabel));
        insights.push(daysSinceLastOpInsight(farmerLogEntries, opType, todayDate));

        const current = deriveRateCheckCurrent(savedLog, opType);
        if (current) {
            insights.push(rateCheckInsight(current, deriveRateCheckPriors(history, savedLog, opType)));
        }
    }

    return pickDailyInsight(insights, todayDate);
}
