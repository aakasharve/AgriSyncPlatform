/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, CMP-1) — one plot's last 7 days against its
 * schedule, for the तुलना card (PLR-D9 T7, founder-approved preview `app/ComparePage.tsx`).
 *
 * Pure, over the REAL comparison (`generatePlotComparison` → per stage and kind of work, the planned items
 * with their day and the work recorded with its day). Nothing is sampled or estimated:
 *   - `expected` = schedule items whose day fell in the last 7 days (today included);
 *   - `done` = those matched by work RECORDED in those same 7 days — the engine's own matcher
 *     (`matchItems`), run on copies of the week's items only;
 *   - `percent` is `null` when nothing was due — the card shows "—", never an invented 100% (P4);
 *   - `todo` = what is still open in those 7 days, newest first, the same kind of work grouped into one
 *     row with a count ("ठिबकने पाणी" × 5, not five rows), at most three rows;
 *   - older open items are only COUNTED (`olderOpen`), never listed — PLR-D9 T7: the old page's eleven
 *     "Drip Irrigation #n — 210 days late" rows were scolding and overwhelming. They are matched the same
 *     way against the work recorded before the 7 days, plus any work of the 7 days left over once the
 *     week's own items were met (work recorded late still counts as recorded).
 *
 * Why not the stage-wide `isMatched` flags (I14 verifier BLOCKER I14-V2-01): the engine credits each log to
 * the OLDEST open item of its stage. A farmer who recorded fertigation every day this week, in a stage that
 * began 30 days ago, read "7 पैकी 0 कामं झाली" with "खत देणे (7 वेळा) — झालं, सांगा" — pushing him to record
 * again work he had already recorded. Matching inside the window says "7 पैकी 7" and "24 older".
 */
import type { ExecutedItem, ExecutionBucket, PlannedItem, PlotComparisonSummary } from '../../types';
import { mapBucketToCategory, type CompareCategory } from './comparePageHelpers';
import { plannedLabelMr } from './compareText';
import { matchItems } from './plotComparisonService';

export const WEEK_DAYS = 7;
export const MAX_TODO_ROWS = 3;

export interface WeekTodo {
    label: string;
    /** How many open items of this kind in the 7 days. */
    count: number;
}

export interface PlotWeek {
    expected: number;
    done: number;
    /** `null` when nothing was due in the 7 days. */
    percent: number | null;
    todo: WeekTodo[];
    /** Open items in the 7 days that did not fit in the three rows. */
    moreTodo: number;
    /** Open items due BEFORE the 7 days (summarised, not listed). */
    olderOpen: number;
}

interface OpenItem { day: number; label: string }

// Fresh copies, so the engine's matcher marks nothing on the summary the details below still read.
const freshPlanned = (p: PlannedItem): PlannedItem => ({ ...p, isMatched: false, matchedExecutionId: undefined });
const freshExecuted = (e: ExecutedItem): ExecutedItem => ({ ...e, isMatchedToPlan: false, isExtra: false, matchedPlanItemId: undefined });

/** One kind of work in one stage: the week's items met by the week's work; the older ones by the rest. */
function weekOfBucket(bucket: ExecutionBucket, from: number, today: number) {
    const category: CompareCategory = mapBucketToCategory(bucket.bucketType);
    const due = bucket.planned.filter(p => typeof p.expectedDay === 'number' && p.expectedDay <= today);
    const inWeek = due.filter(p => p.expectedDay! >= from).map(freshPlanned);
    const before = due.filter(p => p.expectedDay! < from).map(freshPlanned);
    const executed = bucket.executed ?? [];

    const weekWork = executed.filter(e => e.executedDay >= from && e.executedDay <= today).map(freshExecuted);
    matchItems(inWeek, weekWork);

    const earlierWork = [
        ...executed.filter(e => e.executedDay < from),
        ...weekWork.filter(e => !e.isMatchedToPlan),
    ].map(freshExecuted);
    matchItems(before, earlierWork);

    return {
        expected: inWeek.length,
        done: inWeek.filter(p => p.isMatched).length,
        open: inWeek.filter(p => !p.isMatched).map((p): OpenItem => ({ day: p.expectedDay!, label: plannedLabelMr(p.name, category) })),
        olderOpen: before.filter(p => !p.isMatched).length,
    };
}

export function buildPlotWeek(summary: PlotComparisonSummary, days: number = WEEK_DAYS): PlotWeek {
    const today = summary.currentDay;
    const from = today - days + 1;
    const parts = summary.stages.flatMap(stage => stage.buckets.map(bucket => weekOfBucket(bucket, from, today)));

    const expected = parts.reduce((sum, p) => sum + p.expected, 0);
    const done = parts.reduce((sum, p) => sum + p.done, 0);
    const open = parts.flatMap(p => p.open).sort((a, b) => b.day - a.day);

    const grouped = new Map<string, number>();
    for (const x of open) grouped.set(x.label, (grouped.get(x.label) ?? 0) + 1);
    const rows = [...grouped].map(([label, count]) => ({ label, count }));

    return {
        expected,
        done,
        percent: expected > 0 ? Math.round((done / expected) * 100) : null,
        todo: rows.slice(0, MAX_TODO_ROWS),
        moreTodo: rows.slice(MAX_TODO_ROWS).reduce((sum, r) => sum + r.count, 0),
        olderOpen: parts.reduce((sum, p) => sum + p.olderOpen, 0),
    };
}

/** The bar's colour (same thresholds as the approved preview). */
export function weekBarTone(percent: number): 'green' | 'amber' | 'rose' {
    if (percent >= 80) return 'green';
    if (percent >= 55) return 'amber';
    return 'rose';
}
