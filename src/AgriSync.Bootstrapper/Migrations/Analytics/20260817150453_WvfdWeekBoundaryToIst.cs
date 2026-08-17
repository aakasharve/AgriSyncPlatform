// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (wvfd-ist-week-boundary)
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// Moves the <c>mis.wvfd_weekly</c> week and day boundaries to India time.
    ///
    /// <para>
    /// <b>The bug.</b> <c>date_trunc('week', created_at_utc)</c> resolves in the
    /// database session's timezone. The RDS parameter group is UTC and
    /// <c>MisRefreshJob</c> pins nothing, so a farmer's 05:00 IST log - 23:30 UTC
    /// the previous day - was bucketed into the previous week, every day. Early
    /// morning is when farm work happens, so this was not a rare edge.
    /// </para>
    ///
    /// <para>
    /// <b>Why the conversion goes in the view and not in the session.</b> A
    /// session pin in <c>MisRefreshJob</c> fixes one caller. <c>REFRESH</c> can
    /// also be issued by a DBA, by a future job, or by a migration's own
    /// <c>CREATE MATERIALIZED VIEW ... AS</c>, which populates in the migration
    /// runner's session - so after a deploy the view would hold UTC-bucketed
    /// numbers until the first nightly refresh. Worse, a session pin fails
    /// SILENTLY when removed: delete the line in a refactor and nothing breaks,
    /// the number just moves five and a half hours. In the view the answer is
    /// self-describing, a parameter-group change cannot quietly undo it, and a
    /// test can pin the session to UTC and still demand IST.
    /// </para>
    ///
    /// <para>
    /// <b>Why a whole migration for four expressions.</b>
    /// <c>20260502000000_AnalyticsRewrite</c> is already applied on prod and
    /// staging, so EF will never re-run it; editing it in place changes only
    /// freshly-built databases. Recreating a matview means
    /// <c>DROP ... CASCADE</c>, which takes its dependents with it.
    /// </para>
    ///
    /// <para>
    /// <b>The CASCADE reach, measured not guessed.</b> A recursive
    /// <c>pg_depend</c>/<c>pg_rewrite</c> walk from <c>mis.wvfd_weekly</c>
    /// returns exactly three dependents, all matviews, all at depth 1, nothing
    /// deeper: <c>mis.engagement_tier</c>, <c>mis.alert_r2_wau_vs_wvfd</c> and
    /// <c>mis.dwc_score_per_farm_week</c>. All three are recreated below,
    /// verbatim from the migrations that own them, with their indexes and
    /// grants. Dropping a founder-facing analytics view and forgetting to
    /// restore it would be a silent hole in exactly the surface this work is
    /// meant to make honest.
    /// </para>
    ///
    /// <para>
    /// <b>Only the boundary moves.</b> The 48-hour rule, the status set
    /// (<c>Confirmed</c>/<c>Verified</c>) and the day grouping are untouched.
    /// The 48h comparison is <c>timestamptz + INTERVAL</c> - absolute instant
    /// arithmetic, invariant under any session timezone - which is why its tests
    /// stay green THROUGH this change rather than needing re-baselining. If they
    /// move, more than one thing changed.
    /// </para>
    ///
    /// <para>
    /// <b>The day bucket necessarily moves too, and that is correct.</b> WVFD
    /// counts DISTINCT days, so an IST week made of UTC days would be
    /// incoherent: two logs spanning two UTC days can be one IST day. The
    /// grouping RULE is unchanged; only which instants land in which day.
    /// </para>
    ///
    /// <para>
    /// <b><c>Down()</c> is genuinely reversible, and safe on a populated
    /// database.</b> It restores the UTC expressions and recreates the same
    /// three dependents. That is possible here - where the sibling matview
    /// migrations are deliberately forward-only - for one reason worth stating:
    /// a materialized view holds only DERIVED data. Dropping and recreating
    /// these destroys nothing that is not recomputable from
    /// <c>ssf.daily_logs</c> and <c>ssf.verification_events</c>, and
    /// <c>MisRefreshJob</c> repopulates on its next pass. No source-of-truth row
    /// is touched in either direction, so this migration does not join the two
    /// on this branch that cannot be safely rolled back.
    /// </para>
    /// </summary>
    public partial class WvfdWeekBoundaryToIst : Migration
    {
        /// <summary>
        /// The three dependents <c>DROP ... CASCADE</c> removes, recreated
        /// verbatim. Identical in <see cref="Up"/> and <see cref="Down"/> - only
        /// the <c>mis.wvfd_weekly</c> body differs between them, which keeps the
        /// reviewable diff to the four expressions that actually change.
        /// </summary>
        private const string DependentsSql = @"-- == Dependent 1/3: mis.engagement_tier ======================
-- Verbatim from 20260502020000_RestoreBuckets234Matviews.
CREATE MATERIALIZED VIEW mis.engagement_tier AS
SELECT
    week_start,
    engagement_tier::text                AS tier,
    COUNT(DISTINCT farm_id)              AS farm_count
FROM mis.wvfd_weekly
GROUP BY week_start, engagement_tier;

CREATE UNIQUE INDEX ux_mis_engagement_tier
    ON mis.engagement_tier (week_start, tier);


-- == Dependent 2/3: mis.alert_r2_wau_vs_wvfd =================
-- Verbatim from 20260502020000_RestoreBuckets234Matviews.
CREATE MATERIALIZED VIEW mis.alert_r2_wau_vs_wvfd AS
WITH wau_now AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau
    FROM analytics.events
    WHERE actor_user_id IS NOT NULL
      AND occurred_at_utc >= NOW() - INTERVAL '7 days'
),
wau_prev AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau_prev
    FROM analytics.events
    WHERE actor_user_id IS NOT NULL
      AND occurred_at_utc BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
),
wvfd_now AS (
    SELECT AVG(wvfd) AS avg_wvfd
    FROM mis.wvfd_weekly
    WHERE week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
),
wvfd_prev AS (
    SELECT AVG(wvfd) AS avg_wvfd_prev
    FROM mis.wvfd_weekly
    WHERE week_start = (
        SELECT MAX(week_start) FROM mis.wvfd_weekly
        WHERE week_start < (SELECT MAX(week_start) FROM mis.wvfd_weekly)
    )
)
SELECT
    1                                                                            AS id,
    'R2_wau_vs_wvfd'                                                             AS detector,
    'WAU up >10% but WVFD down >10% - growth masking product failure'            AS description,
    (
        wau_now.wau > wau_prev.wau_prev * 1.10
        AND wvfd_now.avg_wvfd IS NOT NULL
        AND wvfd_prev.avg_wvfd_prev IS NOT NULL
        AND wvfd_now.avg_wvfd < wvfd_prev.avg_wvfd_prev * 0.90
    )                                                                            AS breached
FROM wau_now, wau_prev, wvfd_now, wvfd_prev;

CREATE UNIQUE INDEX ux_mis_alert_r2 ON mis.alert_r2_wau_vs_wvfd (id);


-- == Dependent 3/3: mis.dwc_score_per_farm_week ==============
-- Verbatim from 20260505000000_DwcV2Matviews. WITH NO DATA is part
-- of the original and is preserved: MisRefreshJob populates it.
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
  -- WTL v0 placeholder: returns 0 until IDailyLogTranscriptStore is
  -- implemented and ssf.workers is populated.  A later migration will
  -- replace this CTE with the real ssf.workers JOIN.
  -- See pending task: T-DWC-E-WTL-TRANSCRIPT-STORE.
  SELECT DISTINCT farm_id, 0.0::numeric AS reuse_ratio
  FROM analytics.events
  WHERE farm_id IS NOT NULL
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


-- == Grants, exactly as the owning migrations issued them ====
GRANT SELECT ON mis.wvfd_weekly             TO mis_reader;
GRANT SELECT ON mis.engagement_tier         TO mis_reader;
GRANT SELECT ON mis.alert_r2_wau_vs_wvfd    TO mis_reader;
GRANT SELECT ON mis.dwc_score_per_farm_week TO mis_reader;";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly CASCADE;

CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        date_trunc('week', l.created_at_utc AT TIME ZONE 'Asia/Kolkata')::date  AS week_start,
        date_trunc('day',  l.created_at_utc AT TIME ZONE 'Asia/Kolkata')::date  AS log_day,
        BOOL_OR(
            v.occurred_at_utc IS NOT NULL
            AND v.occurred_at_utc <= l.created_at_utc + INTERVAL '48 hours'
            AND v.status IN ('Confirmed', 'Verified')
        ) AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verification_events v ON v.daily_log_id = l.""Id""
    WHERE l.created_at_utc >= NOW() - INTERVAL '53 weeks'
    GROUP BY l.farm_id,
             date_trunc('week', l.created_at_utc AT TIME ZONE 'Asia/Kolkata'),
             date_trunc('day',  l.created_at_utc AT TIME ZONE 'Asia/Kolkata')
),
farm_week AS (
    SELECT
        farm_id,
        week_start,
        COUNT(*) FILTER (WHERE verified_within_48h) AS verified_farm_days
    FROM day_log
    GROUP BY farm_id, week_start
)
SELECT
    farm_id,
    week_start,
    LEAST(verified_farm_days, 7)::int AS wvfd,
    CASE
        WHEN verified_farm_days >= 5 THEN 'A'
        WHEN verified_farm_days >= 3 THEN 'B'
        WHEN verified_farm_days >= 1 THEN 'C'
        ELSE                              'D'
    END AS engagement_tier
FROM farm_week;

CREATE UNIQUE INDEX ux_mis_wvfd_farm_week ON mis.wvfd_weekly (farm_id, week_start);
CREATE        INDEX ix_mis_wvfd_week      ON mis.wvfd_weekly (week_start DESC);
" + DependentsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restores the UTC boundary. Safe on a populated database: see the
            // class docstring - matviews hold derived data only.
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly CASCADE;

CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        date_trunc('week', l.created_at_utc)::date  AS week_start,
        date_trunc('day',  l.created_at_utc)::date  AS log_day,
        BOOL_OR(
            v.occurred_at_utc IS NOT NULL
            AND v.occurred_at_utc <= l.created_at_utc + INTERVAL '48 hours'
            AND v.status IN ('Confirmed', 'Verified')
        ) AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verification_events v ON v.daily_log_id = l.""Id""
    WHERE l.created_at_utc >= NOW() - INTERVAL '53 weeks'
    GROUP BY l.farm_id,
             date_trunc('week', l.created_at_utc),
             date_trunc('day',  l.created_at_utc)
),
farm_week AS (
    SELECT
        farm_id,
        week_start,
        COUNT(*) FILTER (WHERE verified_within_48h) AS verified_farm_days
    FROM day_log
    GROUP BY farm_id, week_start
)
SELECT
    farm_id,
    week_start,
    LEAST(verified_farm_days, 7)::int AS wvfd,
    CASE
        WHEN verified_farm_days >= 5 THEN 'A'
        WHEN verified_farm_days >= 3 THEN 'B'
        WHEN verified_farm_days >= 1 THEN 'C'
        ELSE                              'D'
    END AS engagement_tier
FROM farm_week;

CREATE UNIQUE INDEX ux_mis_wvfd_farm_week ON mis.wvfd_weekly (farm_id, week_start);
CREATE        INDEX ix_mis_wvfd_week      ON mis.wvfd_weekly (week_start DESC);
" + DependentsSql);
        }
    }
}
