using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// DWC v2 §3.4 — the four MIS materialized views that form the
    /// Daily Work Closure scoring spine. Verbatim from the plan with a
    /// single Postgres identifier-quoting correction noted below.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>What lands.</b> Four matviews under the <c>mis</c> schema:
    /// </para>
    /// <list type="bullet">
    /// <item><c>mis.action_simplicity_p50_per_farm</c> — median submitted
    ///   closure duration per farm (last 7 days). Drives the Action
    ///   Simplicity pillar (20 pts).</item>
    /// <item><c>mis.repeat_curve_per_farm</c> — distinct active days
    ///   in the last 7 / last 1 days per farm (last 14-day window).
    ///   Drives the Repeat Behavior pillar (25 pts).</item>
    /// <item><c>mis.gaming_signals_per_farm</c> — per-farm booleans for
    ///   the 3 V1-active anti-gaming heuristics
    ///   (<c>signal_time_static</c>, <c>signal_too_fast_verify</c>,
    ///   <c>signal_perfect_record</c>) plus the placeholder
    ///   <c>signal_gps_static</c> column (FALSE until PostGIS / geo
    ///   columns ship — tracked as <c>T-DWC-GAMING-GPS-ENABLE</c>).
    ///   Aggregated to <c>suspicious</c> (2-of-N) and
    ///   <c>flagged_for_review</c> (1-of-N) per
    ///   <c>ADR-2026-05-04_anti-gaming-heuristics.md</c>.</item>
    /// <item><c>mis.dwc_score_per_farm_week</c> — the score itself.
    ///   Combines six pillar contributions (<c>p_trigger_fit</c>,
    ///   <c>p_action_simp</c>, <c>p_proof</c>, <c>p_reward</c>,
    ///   <c>p_investment</c>, <c>p_repeat</c>) with the 30-pt
    ///   anti-gaming subtraction per
    ///   <c>ADR-2026-05-04_dwc-scoring-formula.md</c>; emits per-farm
    ///   per-week rows with a <c>bucket</c> classification
    ///   (<c>intervention</c> 0–40 / <c>watchlist</c> 41–60 /
    ///   <c>healthy</c> 61–100) and a <c>flag</c> tag
    ///   (<c>suspicious</c> / <c>flagged</c> /
    ///   <c>insufficient_data</c> / <c>ok</c>).</item>
    /// </list>
    ///
    /// <para>
    /// <b>SQL provenance.</b> The body is the verbatim SQL from
    /// <c>DAILY_WORK_CLOSURE_FRAMEWORK_PLAN.md §3.4 Step 1</c> with one
    /// targeted fix: the <c>investment</c> CTE in
    /// <c>mis.dwc_score_per_farm_week</c> originally read
    /// <c>COUNT(DISTINCT w.id)</c>. The actual <c>ssf.workers</c> table
    /// (per <c>20260504000000_WtlV0Entities.cs</c>) names its primary
    /// key <c>"Id"</c> — Postgres folds unquoted identifiers to
    /// lowercase, so the bare <c>w.id</c> resolves to a column that
    /// does not exist and the migration fails to apply. Rewritten to
    /// <c>COUNT(DISTINCT w."Id")</c> to match the live schema. Same
    /// pattern as <c>20260502000000_AnalyticsRewrite</c> (which
    /// consistently uses <c>l."Id"</c> for <c>ssf.daily_logs</c>).
    /// This is the same class of bug the
    /// <c>T-MIS-MATVIEW-REWRITE</c> pending task documented for the
    /// legacy Phase4 migrations.
    /// </para>
    ///
    /// <para>
    /// <b>Idempotency.</b> Every <c>CREATE MATERIALIZED VIEW</c> is
    /// preceded by <c>DROP MATERIALIZED VIEW IF EXISTS … CASCADE</c>
    /// (matches the AnalyticsRewrite + Bucket 1/2/3/4 pattern). Replays
    /// on a fresh DB or a DB that already has earlier versions both
    /// succeed.
    /// </para>
    ///
    /// <para>
    /// <b>Forward-only.</b> <c>Down()</c> raises an exception per the
    /// plan and matches <c>20260502000000_AnalyticsRewrite.Down()</c>.
    /// Rollback is via DB snapshot restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>.
    /// </para>
    ///
    /// <para>
    /// <b>Refresh.</b> The four matviews are appended to
    /// <see cref="AgriSync.Bootstrapper.Jobs.MisRefreshJob"/>'s
    /// <c>ViewsToRefresh</c> list in this same change. Refresh order:
    /// the two upstream bases (<c>mis.wvfd_weekly</c>,
    /// <c>mis.schedule_compliance_weekly</c>) already refresh earlier
    /// in the list; the four new views land after them so the
    /// <c>dwc_score_per_farm_week</c> joins read fresh data.
    /// </para>
    /// </remarks>
    public partial class DwcV2Matviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- mis.action_simplicity_p50_per_farm — median closure.submitted
-- duration per farm, last 7 days. Drives the Action Simplicity
-- pillar (20 pts) of the DWC score.
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.action_simplicity_p50_per_farm CASCADE;
CREATE MATERIALIZED VIEW mis.action_simplicity_p50_per_farm AS
SELECT
  farm_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (props->>'durationMs')::int)::int AS median_duration_ms,
  COUNT(*) AS submitted_count
FROM analytics.events
WHERE event_type = 'closure.submitted'
  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
  AND farm_id IS NOT NULL
GROUP BY farm_id
WITH NO DATA;
CREATE UNIQUE INDEX ux_mis_action_simplicity ON mis.action_simplicity_p50_per_farm (farm_id);


-- ============================================================
-- mis.repeat_curve_per_farm — distinct days in the last 7 / 1 day
-- a farm posted a closure.submitted event. Drives the Repeat
-- Behavior pillar (25 pts).
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.repeat_curve_per_farm CASCADE;
CREATE MATERIALIZED VIEW mis.repeat_curve_per_farm AS
WITH daily_active AS (
  SELECT farm_id, date_trunc('day', occurred_at_utc)::date AS d
  FROM analytics.events
  WHERE event_type = 'closure.submitted' AND farm_id IS NOT NULL
    AND occurred_at_utc >= NOW() - INTERVAL '14 days'
  GROUP BY farm_id, date_trunc('day', occurred_at_utc)::date
)
SELECT
  farm_id,
  COUNT(*) FILTER (WHERE d >= CURRENT_DATE - INTERVAL '7 days') AS d7_active,
  COUNT(*) FILTER (WHERE d >= CURRENT_DATE - INTERVAL '1 days') AS d1_active
FROM daily_active GROUP BY farm_id
WITH NO DATA;
CREATE UNIQUE INDEX ux_mis_repeat_curve ON mis.repeat_curve_per_farm (farm_id);


-- ============================================================
-- mis.gaming_signals_per_farm — per-farm anti-gaming booleans per
-- ADR-2026-05-04_anti-gaming-heuristics. V1 active signal count
-- N=3 (gps_static is FALSE until PostGIS / geo columns ship —
-- tracked as T-DWC-GAMING-GPS-ENABLE). Aggregated to:
--   * suspicious         = (>= 2 of 3 active signals fire)
--   * flagged_for_review = (>= 1 of 3 active signals fire)
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.gaming_signals_per_farm CASCADE;
CREATE MATERIALIZED VIEW mis.gaming_signals_per_farm AS
WITH gps_clusters AS (
  SELECT farm_id, FALSE::boolean AS signal_gps_static  -- pending PostGIS / geo columns
  FROM ssf.daily_logs WHERE FALSE
),
time_clusters AS (
  SELECT
    l.farm_id,
    (STDDEV(EXTRACT(EPOCH FROM l.created_at_utc::time)) < 60
     AND COUNT(*) >= 7) AS signal_time_static
  FROM ssf.daily_logs l
  WHERE l.created_at_utc >= NOW() - INTERVAL '14 days'
  GROUP BY l.farm_id
),
quick_verify AS (
  SELECT
    l.farm_id,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM ssf.verification_events ve
        WHERE ve.daily_log_id = l.""Id""
          AND ve.occurred_at_utc - l.created_at_utc < INTERVAL '5 seconds'
      )
    ) >= 5 AS signal_too_fast_verify
  FROM ssf.daily_logs l
  WHERE l.created_at_utc >= NOW() - INTERVAL '14 days'
  GROUP BY l.farm_id
),
perfect_record AS (
  SELECT
    l.farm_id,
    (COUNT(*) > 14
     AND BOOL_AND(EXISTS (SELECT 1 FROM ssf.verification_events ve WHERE ve.daily_log_id = l.""Id"" AND ve.status = 'Verified'))
     AND NOT BOOL_OR(EXISTS (SELECT 1 FROM ssf.verification_events ve WHERE ve.daily_log_id = l.""Id"" AND ve.status = 'Disputed'))
    ) AS signal_perfect_record
  FROM ssf.daily_logs l
  WHERE l.created_at_utc >= NOW() - INTERVAL '14 days'
  GROUP BY l.farm_id
)
SELECT
  COALESCE(t.farm_id, q.farm_id, p.farm_id) AS farm_id,
  COALESCE(t.signal_time_static,  FALSE) AS signal_time_static,
  COALESCE(q.signal_too_fast_verify, FALSE) AS signal_too_fast_verify,
  COALESCE(p.signal_perfect_record, FALSE) AS signal_perfect_record,
  FALSE AS signal_gps_static,
  ((CASE WHEN t.signal_time_static THEN 1 ELSE 0 END)
 + (CASE WHEN q.signal_too_fast_verify THEN 1 ELSE 0 END)
 + (CASE WHEN p.signal_perfect_record THEN 1 ELSE 0 END)) >= 2 AS suspicious,
  ((CASE WHEN t.signal_time_static THEN 1 ELSE 0 END)
 + (CASE WHEN q.signal_too_fast_verify THEN 1 ELSE 0 END)
 + (CASE WHEN p.signal_perfect_record THEN 1 ELSE 0 END)) >= 1 AS flagged_for_review
FROM time_clusters t
FULL OUTER JOIN quick_verify q USING (farm_id)
FULL OUTER JOIN perfect_record p USING (farm_id)
WITH NO DATA;
CREATE UNIQUE INDEX ux_mis_gaming_signals ON mis.gaming_signals_per_farm (farm_id);


-- ============================================================
-- mis.dwc_score_per_farm_week — the DWC score (per farm × ISO week,
-- 12-week history). Pillar weights and clamps follow
-- ADR-2026-05-04_dwc-scoring-formula. The 30-pt anti-gaming
-- subtraction applies when gaming_signals_per_farm.suspicious=TRUE.
--
-- IMPORTANT: the investment CTE quotes the worker primary key as
-- w.""Id"" (matches ssf.workers from 20260504000000_WtlV0Entities).
-- The plan §3.4 source SQL had bare w.id — Postgres folds that to
-- lowercase 'id' which does not exist on ssf.workers, so the
-- unquoted form fails to apply. Same identifier-quoting discipline
-- as 20260502000000_AnalyticsRewrite (which uses l.""Id"" for
-- ssf.daily_logs). Tracked under T-MIS-MATVIEW-REWRITE as the
-- general class of bug to avoid in matview SQL.
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.dwc_score_per_farm_week CASCADE;
CREATE MATERIALIZED VIEW mis.dwc_score_per_farm_week AS
WITH base_farms AS (
  SELECT DISTINCT farm_id FROM analytics.events WHERE farm_id IS NOT NULL
    AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
),
weeks AS (
  SELECT date_trunc('week', generate_series(NOW() - INTERVAL '12 weeks', NOW(), INTERVAL '1 week'))::date AS week_start
),
matrix AS (
  SELECT b.farm_id, w.week_start FROM base_farms b CROSS JOIN weeks w
),
trigger_fit AS (SELECT farm_id, week_start, compliance_pct FROM mis.schedule_compliance_weekly),
action_simp AS (SELECT farm_id, median_duration_ms FROM mis.action_simplicity_p50_per_farm),
proof AS (SELECT farm_id, week_start, wvfd FROM mis.wvfd_weekly),
proof_attach AS (
  SELECT farm_id, date_trunc('week', occurred_at_utc)::date AS week_start,
         COUNT(*) FILTER (WHERE event_type='proof.attached')::numeric
         / NULLIF(COUNT(*) FILTER (WHERE event_type='closure.submitted'),0)::numeric AS attach_ratio
  FROM analytics.events WHERE event_type IN ('proof.attached','closure.submitted') AND farm_id IS NOT NULL
  GROUP BY farm_id, date_trunc('week', occurred_at_utc)::date
),
reward AS (
  SELECT farm_id, date_trunc('week', occurred_at_utc)::date AS week_start,
         COUNT(*) FILTER (WHERE event_type='closure_summary.viewed')::numeric
         / NULLIF(COUNT(*) FILTER (WHERE event_type='closure.submitted'),0)::numeric AS view_ratio
  FROM analytics.events WHERE event_type IN ('closure_summary.viewed','closure.submitted') AND farm_id IS NOT NULL
  GROUP BY farm_id, date_trunc('week', occurred_at_utc)::date
),
investment AS (
  SELECT w.farm_id, SUM(w.assignment_count)::numeric / NULLIF(COUNT(DISTINCT w.""Id""),0) AS reuse_ratio
  FROM ssf.workers w GROUP BY w.farm_id
),
repeat_b AS (SELECT farm_id, d7_active::numeric / 7.0 AS d7_ratio FROM mis.repeat_curve_per_farm),
gaming AS (SELECT farm_id, suspicious, flagged_for_review FROM mis.gaming_signals_per_farm),
combined AS (
  SELECT m.farm_id, m.week_start,
    LEAST(10, GREATEST(0, 10 * (COALESCE(t.compliance_pct, 0) / 100.0)))                                  AS p_trigger_fit,
    LEAST(20, GREATEST(0, 20 * GREATEST(0, LEAST(1, (90000 - COALESCE(a.median_duration_ms, 90000))::numeric / 60000.0)))) AS p_action_simp,
    LEAST(25, GREATEST(0, 25 * (COALESCE(p.wvfd, 0)::numeric / 7.0 * 0.6 + COALESCE(pa.attach_ratio, 0) * 0.4)))            AS p_proof,
    LEAST(10, GREATEST(0, 10 * COALESCE(r.view_ratio, 0)))                                                AS p_reward,
    LEAST(10, GREATEST(0, 10 * COALESCE(i.reuse_ratio, 0)))                                               AS p_investment,
    LEAST(25, GREATEST(0, 25 * COALESCE(rb.d7_ratio, 0)))                                                 AS p_repeat,
    g.suspicious, g.flagged_for_review
  FROM matrix m
  LEFT JOIN trigger_fit  t  USING (farm_id, week_start)
  LEFT JOIN action_simp  a  USING (farm_id)
  LEFT JOIN proof        p  USING (farm_id, week_start)
  LEFT JOIN proof_attach pa USING (farm_id, week_start)
  LEFT JOIN reward       r  USING (farm_id, week_start)
  LEFT JOIN investment   i  USING (farm_id)
  LEFT JOIN repeat_b     rb USING (farm_id)
  LEFT JOIN gaming       g  USING (farm_id)
)
SELECT
  farm_id, week_start,
  ROUND(p_trigger_fit + p_action_simp + p_proof + p_reward + p_investment + p_repeat
        - (CASE WHEN suspicious THEN 30 ELSE 0 END))::int AS score,
  CASE WHEN suspicious THEN 'suspicious'
       WHEN flagged_for_review THEN 'flagged'
       WHEN (p_trigger_fit + p_action_simp + p_proof + p_reward + p_investment + p_repeat) < 7 THEN 'insufficient_data'
       ELSE 'ok' END AS flag,
  ROUND(p_trigger_fit, 1) AS pillar_trigger_fit,
  ROUND(p_action_simp, 1) AS pillar_action_simplicity,
  ROUND(p_proof, 1)       AS pillar_proof,
  ROUND(p_reward, 1)      AS pillar_reward,
  ROUND(p_investment, 1)  AS pillar_investment,
  ROUND(p_repeat, 1)      AS pillar_repeat,
  CASE
    WHEN ROUND(p_trigger_fit + p_action_simp + p_proof + p_reward + p_investment + p_repeat
               - (CASE WHEN suspicious THEN 30 ELSE 0 END)) BETWEEN 0 AND 40 THEN 'intervention'
    WHEN ROUND(p_trigger_fit + p_action_simp + p_proof + p_reward + p_investment + p_repeat
               - (CASE WHEN suspicious THEN 30 ELSE 0 END)) BETWEEN 41 AND 60 THEN 'watchlist'
    ELSE 'healthy'
  END AS bucket
FROM combined
WITH NO DATA;
CREATE UNIQUE INDEX ux_mis_dwc_farm_week ON mis.dwc_score_per_farm_week (farm_id, week_start);
CREATE        INDEX ix_mis_dwc_bucket    ON mis.dwc_score_per_farm_week (bucket, week_start DESC);


-- ============================================================
-- Permissions — grant SELECT on every new matview to mis_reader.
-- Idempotent: GRANT is no-op if already granted.
-- ============================================================
GRANT SELECT ON mis.action_simplicity_p50_per_farm TO mis_reader;
GRANT SELECT ON mis.repeat_curve_per_farm          TO mis_reader;
GRANT SELECT ON mis.gaming_signals_per_farm        TO mis_reader;
GRANT SELECT ON mis.dwc_score_per_farm_week        TO mis_reader;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Forward-only — matches 20260502000000_AnalyticsRewrite.Down()
            // and the broader "matview migrations don't roll back" convention.
            // Rollback is via DB snapshot restore per
            // _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    RAISE EXCEPTION 'Migration DwcV2Matviews is forward-only. Rollback via DB snapshot restore (see _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md), not via dotnet ef database update.';
END
$$;
");
        }
    }
}
