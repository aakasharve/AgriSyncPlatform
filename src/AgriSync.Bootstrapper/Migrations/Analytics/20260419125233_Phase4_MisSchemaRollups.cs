using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <inheritdoc />
    public partial class Phase4_MisSchemaRollups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
CREATE SCHEMA IF NOT EXISTS mis;

-- Role creation wrapped in DO block to avoid failure if it already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mis_reader') THEN
        CREATE ROLE mis_reader NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA mis TO mis_reader;
GRANT USAGE ON SCHEMA analytics TO mis_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA mis TO mis_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA mis GRANT SELECT ON TABLES TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO mis_reader;

CREATE MATERIALIZED VIEW mis.wvfd_weekly AS
WITH day_log AS (
    SELECT
        l.farm_id,
        DATE_TRUNC('day', l.created_at_utc) AS log_day,
        BOOL_OR(l.verification_status IN ('confirmed','verified')
                AND v.verified_at_utc <= l.created_at_utc + INTERVAL '48 hours') AS verified_within_48h
    FROM ssf.daily_logs l
    LEFT JOIN ssf.verifications v ON v.log_id = l.id
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

CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
SELECT
    s.owner_account_id,
    s.farm_id,
    s.plan_code,
    w_cur.wvfd AS wvfd_this_week,
    w_prev.wvfd AS wvfd_last_week,
    s.current_period_end_utc
FROM accounts.subscriptions s
LEFT JOIN mis.wvfd_weekly w_cur ON w_cur.farm_id = s.farm_id
LEFT JOIN mis.wvfd_weekly w_prev ON w_prev.farm_id = s.farm_id
WHERE s.state = 'Active'
  AND COALESCE(w_cur.wvfd, 0) = 0
  AND COALESCE(w_prev.wvfd, 0) = 0;

CREATE UNIQUE INDEX ux_mis_silent_churn_farm ON mis.silent_churn_watchlist (farm_id);

CREATE MATERIALIZED VIEW mis.d30_retention_paying AS
SELECT
    u.id AS user_id,
    DATE_TRUNC('week', u.registered_at_utc) AS cohort_week,
    (SELECT COUNT(*) FROM analytics.events e WHERE e.actor_user_id = u.id AND e.occurred_at_utc BETWEEN u.registered_at_utc + INTERVAL '28 days' AND u.registered_at_utc + INTERVAL '35 days') > 0 AS retained_d30
FROM public.users u
WHERE u.registered_at_utc >= NOW() - INTERVAL '12 weeks';

CREATE UNIQUE INDEX ux_mis_d30_retention_user ON mis.d30_retention_paying (user_id);

CREATE MATERIALIZED VIEW mis.log_verify_lag AS
SELECT
    l.farm_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.verified_at_utc - l.created_at_utc))/3600) AS median_hours_lag
FROM ssf.daily_logs l
JOIN ssf.verifications v ON v.log_id = l.id
WHERE l.created_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY l.farm_id;

CREATE UNIQUE INDEX ux_mis_log_verify_lag ON mis.log_verify_lag (farm_id);

CREATE MATERIALIZED VIEW mis.correction_rate AS
SELECT
    l.farm_id,
    COUNT(*) FILTER (WHERE l.is_corrected) * 100.0 / NULLIF(COUNT(*), 0) AS correction_rate_pct
FROM ssf.daily_logs l
WHERE l.created_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY l.farm_id;

CREATE UNIQUE INDEX ux_mis_correction_rate ON mis.correction_rate (farm_id);

CREATE MATERIALIZED VIEW mis.voice_log_share AS
SELECT
    farm_id,
    COUNT(CASE WHEN event_type = 'log.created' AND trigger = 'voice' THEN 1 END) * 100.0 / NULLIF(COUNT(CASE WHEN event_type = 'log.created' THEN 1 END), 0) AS voice_share_pct
FROM analytics.events
WHERE occurred_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY farm_id;

CREATE UNIQUE INDEX ux_mis_voice_log_share ON mis.voice_log_share (farm_id);

CREATE MATERIALIZED VIEW mis.activation_funnel AS
WITH steps AS (
    SELECT actor_user_id, '1. registered' AS step FROM analytics.events WHERE event_type = 'user.registered'
    UNION ALL SELECT actor_user_id, '2. farm_created' FROM analytics.events WHERE event_type = 'farm.created'
    UNION ALL SELECT actor_user_id, '3. log_created' FROM analytics.events WHERE event_type = 'log.created'
    UNION ALL SELECT actor_user_id, '4. log_verified' FROM analytics.events WHERE event_type = 'log.verified'
)
SELECT step, COUNT(DISTINCT actor_user_id) as count
FROM steps
GROUP BY step;

CREATE UNIQUE INDEX ux_mis_activation_funnel ON mis.activation_funnel (step);

CREATE MATERIALIZED VIEW mis.engagement_tier AS
SELECT
    engagement_tier,
    COUNT(farm_id) as farm_count
FROM mis.wvfd_weekly
GROUP BY engagement_tier;

CREATE UNIQUE INDEX ux_mis_engagement_tier ON mis.engagement_tier (engagement_tier);

CREATE MATERIALIZED VIEW mis.schedule_adoption_rate AS
SELECT
    1 as id,
    COUNT(DISTINCT farm_id) FILTER (WHERE event_type = 'schedule.adopted') * 100.0 / NULLIF(COUNT(DISTINCT farm_id), 0) as adoption_rate_pct
FROM analytics.events;

CREATE UNIQUE INDEX ux_mis_schedule_adoption_rate ON mis.schedule_adoption_rate (id);

CREATE MATERIALIZED VIEW mis.schedule_migration_rate AS
SELECT
    1 as id,
    COUNT(DISTINCT farm_id) FILTER (WHERE event_type = 'schedule.migrated') * 100.0 / NULLIF(COUNT(DISTINCT farm_id), 0) as migration_rate_pct
FROM analytics.events;
CREATE UNIQUE INDEX ux_mis_schedule_migration_rate ON mis.schedule_migration_rate (id);

CREATE MATERIALIZED VIEW mis.schedule_abandonment_rate AS
SELECT
    1 as id,
    COUNT(DISTINCT farm_id) FILTER (WHERE event_type = 'schedule.abandoned') * 100.0 / NULLIF(COUNT(DISTINCT farm_id), 0) as abandonment_rate_pct
FROM analytics.events;
CREATE UNIQUE INDEX ux_mis_schedule_abandonment_rate ON mis.schedule_abandonment_rate (id);

CREATE MATERIALIZED VIEW mis.schedule_unscheduled_ratio AS
SELECT
    farm_id,
    SUM(CASE WHEN props->>'complianceOutcome' = 'unscheduled' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) as unscheduled_pct
FROM analytics.events
WHERE event_type = 'log.created'
GROUP BY farm_id;
CREATE UNIQUE INDEX ux_mis_schedule_unscheduled_ratio ON mis.schedule_unscheduled_ratio (farm_id);

CREATE MATERIALIZED VIEW mis.gemini_cost_per_farm AS
SELECT
    farm_id,
    DATE_TRUNC('day', occurred_at_utc) AS day,
    SUM(CAST(props->>'cost_usd' AS NUMERIC)) as total_cost_usd
FROM analytics.events
WHERE event_type = 'ai.invocation'
GROUP BY farm_id, DATE_TRUNC('day', occurred_at_utc);

CREATE UNIQUE INDEX ux_mis_gemini_cost ON mis.gemini_cost_per_farm (farm_id, day);
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.gemini_cost_per_farm;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_unscheduled_ratio;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_abandonment_rate;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_migration_rate;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_adoption_rate;
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier;
DROP MATERIALIZED VIEW IF EXISTS mis.activation_funnel;
DROP MATERIALIZED VIEW IF EXISTS mis.voice_log_share;
DROP MATERIALIZED VIEW IF EXISTS mis.correction_rate;
DROP MATERIALIZED VIEW IF EXISTS mis.log_verify_lag;
DROP MATERIALIZED VIEW IF EXISTS mis.d30_retention_paying;
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly;

REVOKE ALL ON SCHEMA mis FROM mis_reader;
REVOKE ALL ON SCHEMA analytics FROM mis_reader;
DROP SCHEMA IF EXISTS mis CASCADE;
");
        }
    }
}
