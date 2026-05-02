using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// T-IGH-03-MIS-MATVIEW-REDESIGN — Buckets 2, 3, and 4 (HAS-CONSUMER subset).
    /// Restores 13 of the 20 candidate matviews against the actual ShramSafal /
    /// analytics.events schema. Drives only matviews with a real in-tree consumer:
    /// either <see cref="AlertDispatcherJob"/> (the 8 R1-R8 detectors) or the
    /// committed Metabase founder dashboard at
    /// <c>build/metabase/dashboards/founder.json</c> (5 cards).
    ///
    /// <para>
    /// <b>Investigation provenance.</b> Per the pending task
    /// <c>IGH_03_MIS_MATVIEW_REDESIGN_2026-05-01.md</c>, each Bucket 2/3/4 matview
    /// must have a documented consumer before reintroduction. The 2026-05-03
    /// investigation (recorded in that pending task's "Bucket 2/3/4 investigation"
    /// section) classified the 20 candidates as:
    /// </para>
    /// <list type="bullet">
    /// <item><b>HAS-CONSUMER (13)</b>:
    ///   <c>engagement_tier</c>, <c>activation_funnel</c>,
    ///   <c>d30_retention_paying</c>, <c>schedule_migration_rate</c>,
    ///   <c>api_health_24h</c>, and <c>alert_r1</c>..<c>alert_r8</c>.</item>
    /// <item><b>NO-CONSUMER (7, deferred)</b>:
    ///   <c>schedule_adoption_rate</c>, <c>schedule_abandonment_rate</c>,
    ///   <c>feature_retention_lift</c>, <c>new_farm_day_snapshot</c>,
    ///   <c>activity_heatmap</c>, <c>cohort_quality_score</c>,
    ///   <c>voice_pipeline_health</c>. Stay dropped until a consumer lands.</item>
    /// </list>
    ///
    /// <para>
    /// <b>Bucket 2 — 4 analytics rollups (Metabase founder dashboard).</b>
    /// Column shapes follow the queries in <c>build/metabase/dashboards/founder.json</c>:
    /// </para>
    /// <list type="bullet">
    /// <item><c>mis.engagement_tier</c> — Card 8 expects
    ///   <c>(tier, week_start, farm_count)</c>. Each row is one
    ///   (week, tier) bucket projected from <c>mis.wvfd_weekly</c>.</item>
    /// <item><c>mis.activation_funnel</c> — Card 9 expects
    ///   <c>(cohort_week, step_order, step_name, count)</c>. Per-cohort funnel
    ///   over <c>analytics.events</c> (registered → farm_created →
    ///   log_created → log_verified).</item>
    /// <item><c>mis.d30_retention_paying</c> — Card 3 expects
    ///   <c>(cohort_week, retention_pct)</c>. % of cohort users that have any
    ///   event in the d28..d35 window. Aggregated by week (not per-user, even
    ///   though the legacy Phase4 SQL was per-user — that shape did not match
    ///   the Metabase query).</item>
    /// <item><c>mis.schedule_migration_rate</c> — Card 10 expects
    ///   <c>week_start</c>. Per-week count of <c>schedule.migrated</c> events.</item>
    /// </list>
    ///
    /// <para>
    /// <b>Bucket 3 — 8 single-row R1..R8 alert detectors</b> (consumer:
    /// <see cref="AlertDispatcherJob"/>). The job queries every alert view with
    /// <c>SELECT detector, description FROM {view} WHERE breached = true LIMIT 1</c>,
    /// so each matview ships the same proven shape that R9 and R10 use:
    /// </para>
    /// <code>
    /// (id INT = 1, detector TEXT, description TEXT, breached BOOLEAN)
    /// </code>
    /// <para>
    /// Each detector's <c>breached</c> expression is computed from
    /// <c>analytics.events</c> + the existing rollups (<c>mis.voice_log_share</c>,
    /// <c>mis.schedule_compliance_weekly</c>). The original Phase 7 SQL used
    /// <c>HAVING</c> without <c>GROUP BY</c> in three places (R3, R6, R8);
    /// that produced 0-or-1 rows by accident, not by design. Rewritten here as
    /// scalar subqueries inside a single-row SELECT so the matview is always
    /// exactly one row and CONCURRENTLY refresh is safe.
    /// </para>
    ///
    /// <para>
    /// <b>Bucket 4 — 1 of the 2 candidate ops matviews.</b>
    /// </para>
    /// <list type="bullet">
    /// <item><c>mis.api_health_24h</c> — Card 13 expects
    ///   <c>(endpoint, error_count, farms_affected, avg_latency_ms,
    ///   max_latency_ms)</c>. Same shape as the legacy Phase_OpsObservability
    ///   matview (which the legacy comments labelled "Used by Metabase Card 13").</item>
    /// <item><c>mis.voice_pipeline_health</c> — DEFERRED: no in-tree consumer.
    ///   <see cref="AdminOpsRepository.GetVoiceTrendAsync"/> queries
    ///   <c>analytics.events</c> directly; no Metabase card references it.</item>
    /// </list>
    ///
    /// <para>
    /// <b>CONCURRENTLY refresh contract.</b> <see cref="MisRefreshJob"/> calls
    /// <c>REFRESH MATERIALIZED VIEW CONCURRENTLY</c>, which requires a UNIQUE
    /// index on every matview. Provided here for each new matview. The 8 R-alerts
    /// share the trivial <c>(id)</c> unique index pattern from R9/R10.
    /// </para>
    ///
    /// <para>
    /// <b>Idempotency.</b> Drops use <c>IF EXISTS</c>. Postgres has no
    /// <c>CREATE MATERIALIZED VIEW IF NOT EXISTS</c>, so we drop-then-create.
    /// <c>GRANT SELECT</c> is idempotent. Running this migration on a fresh DB
    /// or against a DB where the legacy versions still exist both succeed.
    /// </para>
    ///
    /// <para>
    /// <b>Forward-only.</b> <c>Down()</c> drops in reverse dependency order;
    /// rollback is via DB snapshot per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>.
    /// </para>
    /// </summary>
    public partial class RestoreBuckets234Matviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- Idempotency drops — both fresh DB (no-op) and prod-with-legacy
-- (CASCADE handles inter-matview dependencies on wvfd_weekly).
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier            CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.activation_funnel          CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.d30_retention_paying       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_migration_rate    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.api_health_24h             CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r1_smooth_decay      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r3_rubber_stamp      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r4_voice_decay       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r6_flash_churn       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r7_correction_rising CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r8_referral_quality  CASCADE;


-- ============================================================
-- BUCKET 2 — Analytics rollups
-- ============================================================

-- mis.engagement_tier — Metabase Card 8 (Founder dashboard).
-- Card query:  SELECT tier, COUNT(*) AS farm_count
--              FROM mis.engagement_tier
--              WHERE week_start = (SELECT MAX(week_start) FROM mis.engagement_tier)
--              GROUP BY tier ORDER BY tier
-- Shape: one row per (week_start, tier) so the WHERE-MAX pattern can
-- pick the latest week without scanning the full grid.
CREATE MATERIALIZED VIEW mis.engagement_tier AS
SELECT
    week_start,
    engagement_tier::text                AS tier,
    COUNT(DISTINCT farm_id)              AS farm_count
FROM mis.wvfd_weekly
GROUP BY week_start, engagement_tier;

CREATE UNIQUE INDEX ux_mis_engagement_tier
    ON mis.engagement_tier (week_start, tier);


-- mis.activation_funnel — Metabase Card 9.
-- Card query:  SELECT step_name, count
--              FROM mis.activation_funnel
--              WHERE cohort_week = (SELECT MAX(cohort_week) FROM mis.activation_funnel)
--              ORDER BY step_order
-- Shape: one row per (cohort_week, step_order). Cohort = week of
-- user.registered. Steps: registered → farm_created → log_created
-- → log_verified. Counts are users-in-cohort who reached that step.
CREATE MATERIALIZED VIEW mis.activation_funnel AS
WITH cohorts AS (
    SELECT
        actor_user_id,
        date_trunc('week', MIN(occurred_at_utc))::date AS cohort_week
    FROM analytics.events
    WHERE event_type = 'user.registered'
      AND actor_user_id IS NOT NULL
      AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
    GROUP BY actor_user_id
),
reached AS (
    SELECT
        c.cohort_week,
        c.actor_user_id,
        BOOL_OR(e.event_type = 'user.registered') AS r1,
        BOOL_OR(e.event_type = 'farm.created')    AS r2,
        BOOL_OR(e.event_type = 'log.created')     AS r3,
        BOOL_OR(e.event_type = 'log.verified')    AS r4
    FROM cohorts c
    JOIN analytics.events e ON e.actor_user_id = c.actor_user_id
    GROUP BY c.cohort_week, c.actor_user_id
)
SELECT cohort_week, 1 AS step_order, 'registered'   AS step_name, COUNT(*) FILTER (WHERE r1) AS count
FROM reached GROUP BY cohort_week
UNION ALL
SELECT cohort_week, 2 AS step_order, 'farm_created' AS step_name, COUNT(*) FILTER (WHERE r2) AS count
FROM reached GROUP BY cohort_week
UNION ALL
SELECT cohort_week, 3 AS step_order, 'log_created'  AS step_name, COUNT(*) FILTER (WHERE r3) AS count
FROM reached GROUP BY cohort_week
UNION ALL
SELECT cohort_week, 4 AS step_order, 'log_verified' AS step_name, COUNT(*) FILTER (WHERE r4) AS count
FROM reached GROUP BY cohort_week;

CREATE UNIQUE INDEX ux_mis_activation_funnel
    ON mis.activation_funnel (cohort_week, step_order);


-- mis.d30_retention_paying — Metabase Card 3.
-- Card query:  SELECT ROUND(retention_pct::numeric, 1) AS d30_retention_pct
--              FROM mis.d30_retention_paying
--              ORDER BY cohort_week DESC LIMIT 1
-- Shape: one row per cohort_week. retention_pct = % of cohort users
-- with at least one event in the d28..d35 window after registration.
-- (The legacy Phase4 shape was per-user; Metabase's ORDER BY cohort_week
-- + LIMIT 1 implies an aggregated-by-week shape.)
CREATE MATERIALIZED VIEW mis.d30_retention_paying AS
WITH cohorts AS (
    SELECT
        actor_user_id,
        MIN(occurred_at_utc)                                AS first_event_utc,
        date_trunc('week', MIN(occurred_at_utc))::date      AS cohort_week
    FROM analytics.events
    WHERE event_type = 'user.registered'
      AND actor_user_id IS NOT NULL
      AND occurred_at_utc <= NOW() - INTERVAL '35 days'
      AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
    GROUP BY actor_user_id
),
retained AS (
    SELECT
        c.cohort_week,
        c.actor_user_id,
        EXISTS (
            SELECT 1 FROM analytics.events e
            WHERE e.actor_user_id = c.actor_user_id
              AND e.occurred_at_utc BETWEEN c.first_event_utc + INTERVAL '28 days'
                                        AND c.first_event_utc + INTERVAL '35 days'
        ) AS retained_d30
    FROM cohorts c
)
SELECT
    cohort_week,
    COUNT(*)                                                 AS cohort_size,
    ROUND(
        COUNT(*) FILTER (WHERE retained_d30) * 100.0 / NULLIF(COUNT(*), 0)
    , 1)                                                     AS retention_pct
FROM retained
GROUP BY cohort_week;

CREATE UNIQUE INDEX ux_mis_d30_retention_week
    ON mis.d30_retention_paying (cohort_week);


-- mis.schedule_migration_rate — Metabase Card 10.
-- Card query:  SELECT COUNT(*) AS migrations
--              FROM mis.schedule_migration_rate
--              WHERE week_start >= DATE_TRUNC('month', CURRENT_DATE)
-- Shape: one row per (week_start, farm_id) — count(*) over rows is the
-- number of farm-week migration buckets in the current month. Any
-- shape that supports the WHERE-week_start filter satisfies the card.
CREATE MATERIALIZED VIEW mis.schedule_migration_rate AS
SELECT
    date_trunc('week', occurred_at_utc)::date AS week_start,
    farm_id,
    COUNT(*)                                  AS migration_count
FROM analytics.events
WHERE event_type = 'schedule.migrated'
  AND farm_id IS NOT NULL
  AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
GROUP BY date_trunc('week', occurred_at_utc), farm_id;

CREATE UNIQUE INDEX ux_mis_schedule_migration_rate
    ON mis.schedule_migration_rate (week_start, farm_id);


-- ============================================================
-- BUCKET 4 — Ops matview (api_health_24h)
-- ============================================================

-- mis.api_health_24h — Metabase Card 13.
-- Card query:  SELECT endpoint, error_count, farms_affected,
--                     avg_latency_ms, max_latency_ms
--              FROM mis.api_health_24h LIMIT 10
-- Same column shape as the legacy Phase_OpsObservability definition.
CREATE MATERIALIZED VIEW mis.api_health_24h AS
SELECT
    COALESCE(props->>'endpoint', 'unknown')           AS endpoint,
    COUNT(*)                                           AS error_count,
    COUNT(DISTINCT farm_id)                            AS farms_affected,
    ROUND(AVG((props->>'latencyMs')::numeric))         AS avg_latency_ms,
    MAX((props->>'latencyMs')::numeric)                AS max_latency_ms
FROM analytics.events
WHERE event_type IN ('api.error', 'api.slow', 'client.error')
  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
GROUP BY props->>'endpoint';

CREATE UNIQUE INDEX ux_mis_api_health_endpoint
    ON mis.api_health_24h (endpoint);


-- ============================================================
-- BUCKET 3 — R1..R8 alert detectors. All ship the proven
-- (id INT = 1, detector TEXT, description TEXT, breached BOOL)
-- single-row shape that AlertDispatcherJob already understands.
-- ============================================================

-- R1: smooth-decay retention. D30 < 20% of D7 AND D60 < 40% of D30 across
-- registrations in the last 90 days. Rewritten as a scalar subquery so the
-- matview is always exactly one row.
CREATE MATERIALIZED VIEW mis.alert_r1_smooth_decay AS
WITH retention AS (
    SELECT
        COUNT(*) FILTER (WHERE e.occurred_at_utc BETWEEN u.signup + INTERVAL '6 days'
                                                     AND u.signup + INTERVAL '8 days')  AS d7,
        COUNT(*) FILTER (WHERE e.occurred_at_utc BETWEEN u.signup + INTERVAL '28 days'
                                                     AND u.signup + INTERVAL '35 days') AS d30,
        COUNT(*) FILTER (WHERE e.occurred_at_utc BETWEEN u.signup + INTERVAL '58 days'
                                                     AND u.signup + INTERVAL '62 days') AS d60
    FROM (
        SELECT actor_user_id, MIN(occurred_at_utc) AS signup
        FROM analytics.events
        WHERE event_type = 'user.registered' AND actor_user_id IS NOT NULL
        GROUP BY actor_user_id
    ) u
    JOIN analytics.events e ON e.actor_user_id = u.actor_user_id
    WHERE u.signup >= NOW() - INTERVAL '90 days'
)
SELECT
    1                                                                 AS id,
    'R1_smooth_decay'                                                 AS detector,
    'D30 < 20% of D7 AND D60 < 40% of D30 — novelty effect, not habit' AS description,
    (d30 < d7 * 0.2 AND d60 < d30 * 0.4)                              AS breached
FROM retention;

CREATE UNIQUE INDEX ux_mis_alert_r1 ON mis.alert_r1_smooth_decay (id);


-- R2: WAU rising while WVFD falling. WAU up >10% week-over-week
-- AND avg WVFD this week < 90% of last week's = growth masking failure.
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
    'WAU up >10% but WVFD down >10% — growth masking product failure'            AS description,
    (
        wau_now.wau > wau_prev.wau_prev * 1.10
        AND wvfd_now.avg_wvfd IS NOT NULL
        AND wvfd_prev.avg_wvfd_prev IS NOT NULL
        AND wvfd_now.avg_wvfd < wvfd_prev.avg_wvfd_prev * 0.90
    )                                                                            AS breached
FROM wau_now, wau_prev, wvfd_now, wvfd_prev;

CREATE UNIQUE INDEX ux_mis_alert_r2 ON mis.alert_r2_wau_vs_wvfd (id);


-- R3: rubber-stamp verification. >30% of distinct verifiers this week
-- did a 10+ batch in <10s. Original Phase 7 SQL used HAVING without
-- GROUP BY — replaced with a clean ratio.
CREATE MATERIALIZED VIEW mis.alert_r3_rubber_stamp AS
WITH base AS (
    SELECT
        COUNT(DISTINCT actor_user_id) AS total_verifiers
    FROM analytics.events
    WHERE event_type = 'batch.verified'
      AND occurred_at_utc >= NOW() - INTERVAL '7 days'
),
fast AS (
    SELECT
        COUNT(DISTINCT actor_user_id) AS fast_verifiers
    FROM analytics.events
    WHERE event_type = 'batch.verified'
      AND occurred_at_utc >= NOW() - INTERVAL '7 days'
      AND COALESCE((props->>'log_count')::int, 0) >= 10
      AND COALESCE((props->>'elapsed_ms')::int, 0) < 10000
)
SELECT
    1                                                                         AS id,
    'R3_rubber_stamp'                                                         AS detector,
    '>30% of owners verify 10+ logs in <10s — verification signal is fake'    AS description,
    (
        base.total_verifiers > 0
        AND fast.fast_verifiers * 100.0 / NULLIF(base.total_verifiers, 0) > 30
    )                                                                         AS breached
FROM base, fast;

CREATE UNIQUE INDEX ux_mis_alert_r3 ON mis.alert_r3_rubber_stamp (id);


-- R4: voice share decay. Voice share in the last 7 days < 50% of the
-- 35-42 day window's voice share = AI not forming habit.
CREATE MATERIALIZED VIEW mis.alert_r4_voice_decay AS
WITH voice_now AS (
    SELECT
        COUNT(*) FILTER (WHERE event_type = 'log.created' AND trigger = 'voice') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0) AS voice_pct
    FROM analytics.events
    WHERE occurred_at_utc >= NOW() - INTERVAL '7 days'
),
voice_then AS (
    SELECT
        COUNT(*) FILTER (WHERE event_type = 'log.created' AND trigger = 'voice') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0) AS voice_pct_then
    FROM analytics.events
    WHERE occurred_at_utc BETWEEN NOW() - INTERVAL '42 days' AND NOW() - INTERVAL '35 days'
)
SELECT
    1                                                                  AS id,
    'R4_voice_decay'                                                   AS detector,
    'Voice share in week 6 < 50% of week 1 — AI not forming habit'     AS description,
    (
        voice_then.voice_pct_then IS NOT NULL
        AND voice_now.voice_pct IS NOT NULL
        AND voice_now.voice_pct < voice_then.voice_pct_then * 0.5
    )                                                                  AS breached
FROM voice_now, voice_then;

CREATE UNIQUE INDEX ux_mis_alert_r4 ON mis.alert_r4_voice_decay (id);


-- R5: schedule compliance plateau. 4+ farm-weeks in the last 28 days
-- with compliance_pct < 50% = catalog-mismatch territory.
CREATE MATERIALIZED VIEW mis.alert_r5_compliance_plateau AS
SELECT
    1                                                                                   AS id,
    'R5_compliance_plateau'                                                             AS detector,
    'Schedule compliance flat at <50% across 4+ consecutive farm-weeks — catalog mismatch'
                                                                                        AS description,
    (COUNT(*) FILTER (WHERE compliance_pct < 50) >= 4)                                  AS breached
FROM mis.schedule_compliance_weekly
WHERE week_start >= NOW() - INTERVAL '28 days';

CREATE UNIQUE INDEX ux_mis_alert_r5 ON mis.alert_r5_compliance_plateau (id);


-- R6: trial→paid flash churn. >20% of subscriptions activated in the
-- last 60 days were cancelled within 30 days = pricing/value mismatch.
CREATE MATERIALIZED VIEW mis.alert_r6_flash_churn AS
WITH activated AS (
    SELECT actor_user_id, occurred_at_utc AS activated_at
    FROM analytics.events
    WHERE event_type = 'subscription.activated'
      AND actor_user_id IS NOT NULL
      AND occurred_at_utc >= NOW() - INTERVAL '60 days'
),
flash_cancelled AS (
    SELECT a.actor_user_id
    FROM activated a
    WHERE EXISTS (
        SELECT 1 FROM analytics.events c
        WHERE c.actor_user_id = a.actor_user_id
          AND c.event_type = 'subscription.cancelled'
          AND c.occurred_at_utc BETWEEN a.activated_at
                                    AND a.activated_at + INTERVAL '30 days'
    )
)
SELECT
    1                                                                              AS id,
    'R6_flash_churn'                                                               AS detector,
    '>20% of new paid subs cancel within 30 days — pricing or value mismatch'      AS description,
    (
        (SELECT COUNT(*) FROM activated) > 0
        AND (SELECT COUNT(*) FROM flash_cancelled) * 100.0
            / NULLIF((SELECT COUNT(*) FROM activated), 0) > 20
    )                                                                              AS breached;

CREATE UNIQUE INDEX ux_mis_alert_r6 ON mis.alert_r6_flash_churn (id);


-- R7: correction rate rising. 4-week rolling correction rate (log.corrected
-- per log.created) grew by 5+ percentage points across that window.
CREATE MATERIALIZED VIEW mis.alert_r7_correction_rising AS
WITH rolling AS (
    SELECT
        date_trunc('week', occurred_at_utc) AS week,
        COUNT(*) FILTER (WHERE event_type = 'log.corrected') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0) AS correction_pct
    FROM analytics.events
    WHERE occurred_at_utc >= NOW() - INTERVAL '28 days'
    GROUP BY date_trunc('week', occurred_at_utc)
),
spread AS (
    SELECT
        COALESCE(MAX(correction_pct) - MIN(correction_pct), 0) AS pct_growth
    FROM rolling
)
SELECT
    1                                                                       AS id,
    'R7_correction_rising'                                                  AS detector,
    '4-week correction rate grew >=5 points — operator-owner trust degrading' AS description,
    (spread.pct_growth >= 5)                                                AS breached
FROM spread;

CREATE UNIQUE INDEX ux_mis_alert_r7 ON mis.alert_r7_correction_rising (id);


-- R8: referral cohort retention < direct cohort retention. QR-referral
-- channel D30 retention strictly less than direct-signup D30.
CREATE MATERIALIZED VIEW mis.alert_r8_referral_quality AS
WITH by_channel AS (
    SELECT
        COALESCE(props->>'channel', 'direct') AS channel,
        AVG(
            CASE WHEN EXISTS (
                SELECT 1 FROM analytics.events e2
                WHERE e2.actor_user_id = e.actor_user_id
                  AND e2.occurred_at_utc BETWEEN e.occurred_at_utc + INTERVAL '28 days'
                                             AND e.occurred_at_utc + INTERVAL '35 days'
            ) THEN 1 ELSE 0 END
        )::numeric AS d30_retention
    FROM analytics.events e
    WHERE event_type = 'user.registered'
      AND actor_user_id IS NOT NULL
      AND occurred_at_utc >= NOW() - INTERVAL '60 days'
    GROUP BY COALESCE(props->>'channel', 'direct')
)
SELECT
    1                                                                          AS id,
    'R8_referral_quality'                                                      AS detector,
    'QR-referral D30 < direct D30 — incentivising wrong invitations'           AS description,
    (
        COALESCE(MAX(d30_retention) FILTER (WHERE channel = 'qr_referral'), 0) <
        COALESCE(MAX(d30_retention) FILTER (WHERE channel = 'direct'), 0)
    )                                                                          AS breached
FROM by_channel;

CREATE UNIQUE INDEX ux_mis_alert_r8 ON mis.alert_r8_referral_quality (id);


-- ============================================================
-- Permissions — grant SELECT to mis_reader. Idempotent.
-- ============================================================
GRANT SELECT ON mis.engagement_tier             TO mis_reader;
GRANT SELECT ON mis.activation_funnel           TO mis_reader;
GRANT SELECT ON mis.d30_retention_paying        TO mis_reader;
GRANT SELECT ON mis.schedule_migration_rate     TO mis_reader;
GRANT SELECT ON mis.api_health_24h              TO mis_reader;
GRANT SELECT ON mis.alert_r1_smooth_decay       TO mis_reader;
GRANT SELECT ON mis.alert_r2_wau_vs_wvfd        TO mis_reader;
GRANT SELECT ON mis.alert_r3_rubber_stamp       TO mis_reader;
GRANT SELECT ON mis.alert_r4_voice_decay        TO mis_reader;
GRANT SELECT ON mis.alert_r5_compliance_plateau TO mis_reader;
GRANT SELECT ON mis.alert_r6_flash_churn        TO mis_reader;
GRANT SELECT ON mis.alert_r7_correction_rising  TO mis_reader;
GRANT SELECT ON mis.alert_r8_referral_quality   TO mis_reader;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Forward-only chain (matches AnalyticsRewrite + Bucket 1
            // convention). Rollback via DB snapshot per RDS_PROVISIONING.md.
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r8_referral_quality   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r7_correction_rising  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r6_flash_churn        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r4_voice_decay        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r3_rubber_stamp       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r1_smooth_decay       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.api_health_24h              CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_migration_rate     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.d30_retention_paying        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.activation_funnel           CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier             CASCADE;
");
        }
    }
}
