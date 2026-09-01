import type { AxisPoint } from '@/components/data';
import type { SparkTone } from '@/components/data';
import { DATE_FORMATS, fmt } from '@/lib/format';
import type { CohortWeeklyTrendDto } from './farmer-health.types';

/**
 * WHAT THE DWC SCORE ACTUALLY IS — read out of the matview that computes it,
 * on 2026-09-01, rather than taken from the plan or from the prototype.
 *
 * Source: `mis.dwc_score_per_farm_week`, created by
 * `20260505000000_DwcV2Matviews.cs:220-300` and RECREATED unchanged in this
 * respect by `20260817150453_WvfdWeekBoundaryToIst.cs:212-294`.
 *
 * Six properties follow, and four of them contradict something the live screen
 * said.
 *
 * ── (1) 🔴 THE INVESTMENT PILLAR IS A PLACEHOLDER AND SCORES ZERO FOR EVERY
 *        FARM, EVERY WEEK, ALWAYS ─────────────────────────────────────────
 * The `investment` CTE is, verbatim:
 *
 *     -- WTL v0 placeholder: returns 0 until IDailyLogTranscriptStore is
 *     -- implemented and ssf.workers is populated.
 *     SELECT DISTINCT farm_id, 0.0::numeric AS reuse_ratio
 *
 * so `p_investment = 10 * 0 = 0` for everybody. The old Pillar heatmap
 * rendered that as `0.0 / 10` with a red bar and an "N failing" count — a
 * measured finding about farms, presented in the same shape as the five real
 * pillars. It is not a finding. It is an unbuilt feature.
 *
 * TWO CONSEQUENCES, and the second is the one that reaches every other figure
 * on the screen:
 *   a. the Investment row is NOT MEASURED, and its failing-farms count is
 *      100% by construction and must not be printed as a finding;
 *   b. **the achievable total is 90, not 100.** The bands are still absolute —
 *      0-40 intervention, 41-60 watchlist — so a farm doing everything the
 *      platform can currently measure tops out at 90, and "61 or above is
 *      healthy" is 68% of what is reachable, not 61%.
 * The v3 prototype states (b) on screen in its own words. The live console
 * never did.
 *
 * ── (2) 🛑 A FARM THAT DID NOTHING IS SCORED, NOT ABSENT ─────────────────
 * `matrix` is `base_farms CROSS JOIN weeks`, and every pillar CTE is a LEFT
 * JOIN with `COALESCE(..., 0)`. So every farm with any event in the last 12
 * weeks has a row in every one of those weeks, and a farm that did nothing
 * scores a real low number rather than dropping out. The intervention queue
 * therefore mixes "trying and failing" with "never started", and this feed
 * carries nothing that tells them apart — `CohortBucketDto` has no `flag`
 * field, so even `insufficient_data` (raw pillars < 7) does not reach the
 * client.
 *
 * ── (3) 🛑 A SUSPICION PENALTY OF 30 POINTS DECIDES THE BUCKET ───────────
 * `- (CASE WHEN suspicious THEN 30 ELSE 0 END)` is applied BEFORE the bucket
 * is computed, so a farm flagged for gaming lands in the intervention queue
 * for a reason that has nothing to do with needing help. The queue cannot say
 * which, because the flag is not in the DTO.
 *
 * ── (4) 🛑 THREE OF THE SIX PILLARS DO NOT VARY BY WEEK ──────────────────
 * `action_simp`, `repeat_b` and `gaming` join `USING (farm_id)` only — no
 * week. So a farm's Action-simplicity, Repeat and suspicion are the same
 * number in every week of the trend, and the weekly line can only move on
 * Trigger fit, Proof and Reward.
 *
 * ── (5) 🛑 THE MATVIEW IS UNPOPULATED ON PRODUCTION AND HAS BEEN SINCE
 *        2026-06-05 ───────────────────────────────────────────────────────
 * Recorded in the repo, in the migration's own remarks
 * (`20260817150453_WvfdWeekBoundaryToIst.cs:95-110`): it is created `WITH NO
 * DATA`, `MisRefreshJob` refreshes CONCURRENTLY, and CONCURRENTLY cannot
 * populate an empty matview. The one-time repair is deployment-tracker task
 * D3 (`T-MATVIEW-INITIAL-REFRESH`), logged there as **NOT LIVE — P3**, with
 * production's own error quoted: `0A000: CONCURRENTLY cannot be used when the
 * materialized view is not populated ... mis.dwc_score_per_farm_week`.
 * So an empty Farmer Health screen in production today is most probably NOT
 * "scoring active, data accumulating" — it is a view that was never filled.
 *
 * ── (6) THE ENGAGEMENT TIERS COME FROM A DIFFERENT MATVIEW, AT ITS OWN
 *        WEEK ────────────────────────────────────────────────────────────
 * Tiers are `mis.wvfd_weekly.engagement_tier` at `MAX(week_start)` of THAT
 * view (`AdminCohortPatternsRepository.cs:186-190`); everything else is
 * `mis.dwc_score_per_farm_week` at `MAX(week_start)` of THAT one. Two views,
 * two clocks, one screen. And `COALESCE(w.engagement_tier,'D')` means a farm
 * with no tier is counted as the WORST tier rather than as unmeasured.
 */

/** The six pillars, in weighting order, with the max each carries. */
export interface PillarMeta {
  key: string;
  label: string;
  max: number;
  /**
   * FALSE when the pillar cannot produce a reading at all, whatever the
   * server sends. Property (1): `investment` is a documented placeholder in
   * the matview, so its 0 is not a measurement and must never be drawn as one.
   */
  measurable: boolean;
  /** Why it cannot be measured — rendered, not just commented. */
  why?: string;
}

export const PILLARS: readonly PillarMeta[] = [
  { key: 'triggerFit', label: 'Trigger fit', max: 10, measurable: true },
  { key: 'actionSimplicity', label: 'Action simplicity', max: 20, measurable: true },
  { key: 'proof', label: 'Proof', max: 25, measurable: true },
  { key: 'reward', label: 'Reward', max: 10, measurable: true },
  {
    key: 'investment',
    label: 'Investment',
    max: 10,
    measurable: false,
    why: 'The scorer has never computed this pillar. Its input is a placeholder that returns 0 for every farm until the worker-transcript store is built (T-DWC-E-WTL-TRANSCRIPT-STORE), so the 0 the server sends is the placeholder, not a reading — and every farm "fails" it by construction.',
  },
  { key: 'repeat', label: 'Repeat', max: 25, measurable: true },
] as const;

/** The axis, in the shape `fillAxis` wants. Order is fixed and never sorted. */
export const PILLAR_AXIS: readonly AxisPoint[] = PILLARS.map((p) => ({
  key: p.key,
  label: p.label,
}));

export const PILLAR_BY_KEY = new Map(PILLARS.map((p) => [p.key, p]));

/** 100 on paper. */
export const SCORE_MAX = PILLARS.reduce((n, p) => n + p.max, 0);

/** 90 in practice — property (1b). This is the number a farm can actually
 *  reach, and it is what the thresholds should be read against. */
export const SCORE_REACHABLE = PILLARS.reduce((n, p) => n + (p.measurable ? p.max : 0), 0);

/** The two band edges, from the matview's own `CASE` (`:295-299`):
 *  `BETWEEN 0 AND 40` -> intervention, `BETWEEN 41 AND 60` -> watchlist. */
export const INTERVENTION_AT = 40;
export const WATCHLIST_FROM = INTERVENTION_AT + 1;
export const WATCHLIST_TO = 60;

/** One rule, used for a total, a pillar share and a weekly average alike. */
export function bandTone(ratio: number): SparkTone {
  if (ratio > WATCHLIST_TO / SCORE_MAX) return 'green';
  if (ratio > INTERVENTION_AT / SCORE_MAX) return 'amber';
  return 'red';
}

/** The server's caps, from the repository's own call
 *  (`AdminCohortPatternsRepository.cs:38-39`). A list at its cap is a
 *  truncated prefix of `ORDER BY score ASC`, not the whole bucket. */
export const QUEUE_LIMIT = 50;
export const WATCHLIST_LIMIT = 100;

/* ───────────────────────────────────────────────── the weekly trend axis */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * THE TREND AXIS, BUILT WITHOUT A CLOCK.
 *
 * Every other chart in this console anchors its axis to the server's
 * `meta.lastRefreshedUtc`. This endpoint sends no envelope and therefore no
 * stamp (see `farmerHealthApi`), so there is no honest way to say where "now"
 * is — and `new Date()` at render is the fabricated-freshness defect (D5).
 *
 * So the axis runs from the OLDEST returned week to the NEWEST returned week,
 * one slot per week. That reveals every INTERIOR hole — a week between two
 * measured weeks that carries no row — and it invents no boundary. What it
 * cannot show is a hole at either END, and the screen says so in words rather
 * than letting the reader assume the window is complete.
 *
 * Guarded at 53 slots: a corrupt pair of dates must not build a 10,000-element
 * array. 53 is one calendar year of weeks, and the feed asks for eight.
 */
export const TREND_MAX_SLOTS = 53;

export function trendAxis(weeks: readonly CohortWeeklyTrendDto[]): AxisPoint[] {
  const stamps = weeks
    .map((w) => Date.parse(w.weekStart))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (stamps.length === 0) return [];

  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  const span = Math.round((last - first) / WEEK_MS);
  /* A negative or absurd span means the dates are not weekly at all. Fall back
     to the rows themselves, in order, rather than to an invented grid. */
  if (span < 0 || span + 1 > TREND_MAX_SLOTS) {
    return weeks.map((w) => ({ key: w.weekStart, label: weekLabel(w.weekStart) }));
  }

  const axis: AxisPoint[] = [];
  for (let i = 0; i <= span; i++) {
    const key = isoDate(first + i * WEEK_MS);
    axis.push({ key, label: weekLabel(key) });
  }
  return axis;
}

/** `yyyy-MM-dd` in UTC — the spelling `DateOnly` serialises to, so an axis key
 *  and a row key compare as strings without a timezone in between. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "10 Aug" — day-first, matching every other axis in this console. */
export function weekLabel(iso: string): string {
  return fmt.date(iso, DATE_FORMATS.nsmWeek) ?? iso;
}
