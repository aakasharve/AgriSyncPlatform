using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// Fixes three root-cause bugs identified in T-MIS-MATVIEW-REWRITE:
    ///
    ///   Bug 1 — mis.wvfd_weekly had no week_start column.
    ///           AdminMisRepository.GetWvfdHistoryAsync grouped by week_start → silent empty result.
    ///           Fix: rewrite view to output (farm_id, week_start, wvfd, engagement_tier)
    ///           covering 53 weeks of history via ssf.daily_logs group-by-week.
    ///
    ///   Bug 2 — mis.silent_churn_watchlist was missing weeks_silent and last_log_at.
    ///           AdminMisRepository.GetSilentChurnAsync queried both → silent empty result.
    ///           Fix: rewrite view to include weeks_silent (count of 0-WVFD weeks in last 8w)
    ///           and last_log_at (correlated subquery on ssf.daily_logs).
    ///
    ///   Bug 3 — mis.alert_r5_compliance_plateau depended on mis.schedule_compliance_weekly
    ///           which was never created. MisRefreshJob logged an error every night for R5.
    ///           Fix: create mis.schedule_compliance_weekly from analytics.events.
    ///
    ///   Cascade fixes — views that depend on mis.wvfd_weekly are also corrected:
    ///     mis.engagement_tier       — scoped to MAX(week_start) so tier counts are current-week only
    ///     mis.cohort_quality_score  — WVFD subquery scoped to latest week
    ///     mis.alert_r2_wau_vs_wvfd  — WVFD average scoped to latest week
    /// </summary>
    public partial class MIS_MatViewHealthFix : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- STEP 1: Drop all broken/affected views (reverse-dependency order)
-- ============================================================

-- R-views that depend on wvfd_weekly
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd;

-- R5 depends on schedule_compliance_weekly (which doesn't exist yet)
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_compliance_weekly;

-- cohort_quality_score uses a wvfd subquery
DROP MATERIALIZED VIEW IF EXISTS mis.cohort_quality_score;

-- silent_churn depends on wvfd_weekly
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;

-- engagement_tier is a direct rollup of wvfd_weekly
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier;

-- base view being fixed
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly;


-- ============================================================
-- STEP 2: mis.wvfd_weekly — add week_start column
-- Now covers 53 weeks of history. One row per (farm, week).
-- Used by: AdminMisRepository.GetWvfdHistoryAsync / GetFarmsListAsync
-- ============================================================
CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        date_trunc('week', l.created_at_utc)::date  AS week_start,
        date_trunc('day',  l.created_at_utc)::date  AS log_day,
        BOOL_OR(
            v.verified_at_utc IS NOT NULL
            AND v.verified_at_utc <= l.created_at_utc + INTERVAL '48 hours'
            AND v.status IN ('confirmed', 'verified')
        ) AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verifications v ON v.log_id = l.""Id""
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
    LEAST(verified_farm_days, 7)::int                AS wvfd,
    CASE
        WHEN verified_farm_days >= 5 THEN 'A'
        WHEN verified_farm_days >= 3 THEN 'B'
        WHEN verified_farm_days >= 1 THEN 'C'
        ELSE                              'D'
    END                                              AS engagement_tier
FROM farm_week;

CREATE UNIQUE INDEX ux_mis_wvfd_farm_week ON mis.wvfd_weekly (farm_id, week_start);
CREATE        INDEX ix_mis_wvfd_week      ON mis.wvfd_weekly (week_start DESC);


-- ============================================================
-- STEP 3: mis.engagement_tier — scope to current week only
-- Phase 4 counted all rows; after adding week_start each farm
-- has N rows, so we must filter to the latest week.
-- ============================================================
CREATE MATERIALIZED VIEW mis.engagement_tier AS
SELECT
    engagement_tier,
    COUNT(farm_id) AS farm_count
FROM mis.wvfd_weekly
WHERE week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)
GROUP BY engagement_tier;

CREATE UNIQUE INDEX ux_mis_engagement_tier ON mis.engagement_tier (engagement_tier);


-- ============================================================
-- STEP 4: mis.silent_churn_watchlist — add weeks_silent + last_log_at
-- weeks_silent = # of 0-WVFD weeks in the last 8 weeks
-- last_log_at  = latest log timestamp from ssf.daily_logs
-- ============================================================
CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
WITH wvfd_recent AS (
    SELECT
        farm_id,
        ROUND(AVG(wvfd)::numeric, 2)          AS avg_wvfd_2w,
        COUNT(*) FILTER (WHERE wvfd = 0)::int AS weeks_silent
    FROM mis.wvfd_weekly
    WHERE week_start >= (SELECT MAX(week_start) FROM mis.wvfd_weekly) - INTERVAL '8 weeks'
    GROUP BY farm_id
)
SELECT
    s.owner_account_id,
    s.farm_id,
    s.plan_code,
    COALESCE(wr.avg_wvfd_2w, 0)::numeric(4,2)  AS avg_wvfd_2w,
    COALESCE(wr.weeks_silent, 0)               AS weeks_silent,
    s.current_period_end_utc,
    (s.current_period_end_utc - NOW())         AS days_until_renewal,
    (
        SELECT MAX(l.created_at_utc)
        FROM ssf.daily_logs l
        WHERE l.farm_id = s.farm_id
    )                                          AS last_log_at
FROM accounts.subscriptions s
LEFT JOIN wvfd_recent wr ON wr.farm_id = s.farm_id
WHERE s.state = 'Active'
  AND COALESCE(wr.avg_wvfd_2w, 0) < 1;

CREATE UNIQUE INDEX ux_mis_silent_churn_farm ON mis.silent_churn_watchlist (farm_id);


-- ============================================================
-- STEP 5: mis.cohort_quality_score — scope WVFD to latest week
-- Phase 7 used AVG(wvfd) across all rows; with multi-week history
-- this would average across 52 weeks, diluting current performance.
-- ============================================================
CREATE MATERIALIZED VIEW mis.cohort_quality_score AS
WITH cohorts AS (
    SELECT
        actor_user_id,
        date_trunc('week', MIN(occurred_at_utc)) AS signup_week,
        props->>'channel'                         AS channel
    FROM analytics.events
    WHERE event_type = 'user.registered'
    GROUP BY actor_user_id, props->>'channel'
),
d30 AS (
    SELECT
        c.actor_user_id,
        c.channel,
        c.signup_week,
        (SELECT COUNT(*) > 0
         FROM analytics.events e2
         WHERE e2.actor_user_id = c.actor_user_id
           AND e2.occurred_at_utc BETWEEN c.signup_week + INTERVAL '28 days'
                                      AND c.signup_week + INTERVAL '35 days') AS retained_d30,
        (SELECT COUNT(*) > 0
         FROM analytics.events e3
         WHERE e3.actor_user_id = c.actor_user_id
           AND e3.event_type = 'subscription.activated')                       AS converted_paid,
        (SELECT COUNT(*) > 0
         FROM analytics.events e4
         WHERE e4.actor_user_id = c.actor_user_id
           AND e4.event_type = 'invitation.issued')                            AS sent_referral
    FROM cohorts c
)
SELECT
    COALESCE(channel, 'direct') AS channel,
    signup_week,
    COUNT(*)                                                      AS cohort_size,
    ROUND(AVG(retained_d30::int)  * 100, 1)                      AS d30_retention_pct,
    ROUND(AVG(converted_paid::int)* 100, 1)                      AS paid_conversion_pct,
    ROUND(AVG(sent_referral::int) * 100, 1)                      AS referral_rate_pct,
    ROUND(
        0.4 * AVG(retained_d30::int)   * 100
        + 0.3 * COALESCE(
            (SELECT AVG(wvfd)
             FROM mis.wvfd_weekly
             WHERE week_start = (SELECT MAX(week_start) FROM mis.wvfd_weekly)),
            0)
        + 0.2 * AVG(converted_paid::int) * 100
        + 0.1 * AVG(sent_referral::int)  * 100
    , 1)                                                          AS cohort_quality_score
FROM d30
GROUP BY channel, signup_week;

CREATE INDEX ix_mis_cqs ON mis.cohort_quality_score (channel, signup_week);


-- ============================================================
-- STEP 6: mis.alert_r2_wau_vs_wvfd — scope WVFD to latest week
-- Phase 7 cross-joined analytics.events with mis.wvfd_weekly
-- (missing WHERE → Cartesian product). Rewritten cleanly.
-- ============================================================
CREATE MATERIALIZED VIEW mis.alert_r2_wau_vs_wvfd AS
WITH this_week AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau
    FROM analytics.events
    WHERE occurred_at_utc >= NOW() - INTERVAL '7 days'
),
last_week AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau_prev
    FROM analytics.events
    WHERE occurred_at_utc BETWEEN NOW() - INTERVAL '14 days'
                              AND NOW() - INTERVAL '7 days'
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
    1                                                                    AS id,
    'R2_wau_vs_wvfd'                                                     AS detector,
    'WAU up >10% but WVFD down >10% — growth masking product failure'    AS description,
    (
        tw.wau > lw.wau_prev * 1.10
        AND COALESCE(wn.avg_wvfd, 0) < COALESCE(wp.avg_wvfd_prev, 0) * 0.90
    )                                                                    AS breached
FROM this_week tw, last_week lw, wvfd_now wn, wvfd_prev wp;

CREATE UNIQUE INDEX ux_mis_alert_r2 ON mis.alert_r2_wau_vs_wvfd (id);


-- ============================================================
-- STEP 7: mis.schedule_compliance_weekly — NEW (was missing)
-- Required by mis.alert_r5_compliance_plateau.
-- Derives schedule compliance % per week from analytics.events.
-- ============================================================
CREATE MATERIALIZED VIEW mis.schedule_compliance_weekly AS
SELECT
    date_trunc('week', occurred_at_utc)::date                               AS week_start,
    ROUND(
        COUNT(*) FILTER (WHERE props->>'complianceOutcome' = 'scheduled') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE props ? 'complianceOutcome'), 0)
    , 1)                                                                    AS compliance_pct,
    COUNT(*) FILTER (WHERE props ? 'complianceOutcome')                     AS total_tracked_logs
FROM analytics.events
WHERE event_type = 'log.created'
  AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
GROUP BY date_trunc('week', occurred_at_utc);

CREATE UNIQUE INDEX ux_mis_schedule_compliance_weekly ON mis.schedule_compliance_weekly (week_start);


-- ============================================================
-- STEP 8: mis.alert_r5_compliance_plateau — dependency now exists
-- ============================================================
CREATE MATERIALIZED VIEW mis.alert_r5_compliance_plateau AS
SELECT
    1                                                                             AS id,
    'R5_compliance_plateau'                                                       AS detector,
    'Schedule compliance flat at <50% across 4+ consecutive cohorts — catalog mismatch' AS description,
    (COUNT(*) FILTER (WHERE compliance_pct < 50) >= 4)                           AS breached
FROM mis.schedule_compliance_weekly
WHERE week_start >= NOW() - INTERVAL '28 days';

CREATE UNIQUE INDEX ux_mis_alert_r5 ON mis.alert_r5_compliance_plateau (id);


-- ============================================================
-- Permissions: grant mis_reader access to new/recreated views
-- ============================================================
GRANT SELECT ON mis.wvfd_weekly                  TO mis_reader;
GRANT SELECT ON mis.engagement_tier              TO mis_reader;
GRANT SELECT ON mis.silent_churn_watchlist       TO mis_reader;
GRANT SELECT ON mis.cohort_quality_score         TO mis_reader;
GRANT SELECT ON mis.alert_r2_wau_vs_wvfd         TO mis_reader;
GRANT SELECT ON mis.schedule_compliance_weekly   TO mis_reader;
GRANT SELECT ON mis.alert_r5_compliance_plateau  TO mis_reader;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- Reverse: drop fixes, restore Phase 4/7 originals

DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_compliance_weekly;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd;
DROP MATERIALIZED VIEW IF EXISTS mis.cohort_quality_score;
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier;
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly;

-- Restore Phase 4 single-snapshot wvfd_weekly
CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        DATE_TRUNC('day', l.created_at_utc) AS log_day,
        BOOL_OR(v.verified_at_utc IS NOT NULL
                AND v.verified_at_utc <= l.created_at_utc + INTERVAL '48 hours'
                AND v.status IN ('confirmed','verified')) AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verifications v ON v.log_id = l.""Id""
    WHERE l.created_at_utc >= NOW() - INTERVAL '8 days'
    GROUP BY l.farm_id, DATE_TRUNC('day', l.created_at_utc)
),
farm_week AS (
    SELECT
        farm_id,
        COUNT(*) FILTER (WHERE verified_within_48h) AS verified_farm_days
    FROM day_log
    WHERE log_day >= NOW() - INTERVAL '7 days'
    GROUP BY farm_id
)
SELECT
    farm_id,
    LEAST(verified_farm_days, 7) AS wvfd,
    CASE
        WHEN verified_farm_days >= 5 THEN 'A'
        WHEN verified_farm_days >= 3 THEN 'B'
        WHEN verified_farm_days >= 1 THEN 'C'
        ELSE 'D'
    END AS engagement_tier
FROM farm_week;

CREATE UNIQUE INDEX ux_mis_wvfd_farm ON mis.wvfd_weekly (farm_id);

CREATE MATERIALIZED VIEW mis.engagement_tier AS
SELECT engagement_tier, COUNT(farm_id) AS farm_count
FROM mis.wvfd_weekly GROUP BY engagement_tier;
CREATE UNIQUE INDEX ux_mis_engagement_tier ON mis.engagement_tier (engagement_tier);

CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
WITH wvfd_last2 AS (
    SELECT farm_id, AVG(wvfd) AS avg_wvfd_2w FROM mis.wvfd_weekly GROUP BY farm_id
)
SELECT s.owner_account_id, s.farm_id, s.plan_code,
    COALESCE(w.avg_wvfd_2w, 0)::numeric(4,2) AS avg_wvfd_2w,
    s.current_period_end_utc,
    (s.current_period_end_utc - NOW()) AS days_until_renewal
FROM accounts.subscriptions s
LEFT JOIN wvfd_last2 w ON w.farm_id = s.farm_id
WHERE s.state = 'Active' AND COALESCE(w.avg_wvfd_2w, 0) < 1;
CREATE UNIQUE INDEX ux_mis_silent_churn_farm ON mis.silent_churn_watchlist (farm_id);
");
        }
    }
}
