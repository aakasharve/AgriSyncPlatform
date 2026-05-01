using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// T-IGH-03-ANALYTICS-MIGRATION-REWRITE: single canonical rebuild
    /// of the MIS materialized-view layer against the actual ShramSafal
    /// schema (Sub-plan 03 Task 9).
    ///
    /// <para>
    /// <b>What this supersedes.</b> Five earlier migrations in this
    /// chain are intentionally turned into no-ops by this rewrite:
    /// <list type="bullet">
    /// <item><c>Phase4_MisSchemaRollups</c></item>
    /// <item><c>Phase7_BehavioralAnalytics</c></item>
    /// <item><c>Phase_OpsObservability</c></item>
    /// <item><c>MIS_MatViewHealthFix</c></item>
    /// <item><c>MIS_DropVerificationsCompatView</c></item>
    /// </list>
    /// Every one of those referenced columns or tables that did not
    /// match the live schema (<c>ssf.verifications</c> didn't exist,
    /// <c>accounts.subscriptions</c> has no <c>farm_id</c>,
    /// <c>public.users</c> has <c>created_at_utc</c> not
    /// <c>registered_at_utc</c>, <c>ssf.daily_logs</c> has no
    /// <c>is_corrected</c> / <c>verification_status</c>). The 2026-04-27
    /// audit and the 2026-05-01 verifier round both flagged this; the
    /// original plan called for "no-op 3" but the post-audit history
    /// added two more broken patches (<c>MIS_MatViewHealthFix</c> +
    /// <c>MIS_DropVerificationsCompatView</c>) that need to be
    /// superseded for the same reason. See _COFOUNDER pending-task
    /// <c>IGH_03_ANALYTICS_MIGRATION_REWRITE_2026-04-28.md</c>.
    /// </para>
    ///
    /// <para>
    /// <b>Scope (per 2026-05-01 D1.B + D2.A + D3.B + S1 scope correction
    /// signed off by Akash).</b>
    /// </para>
    ///
    /// <para><b>Rebuilt — 10 production-read matviews:</b></para>
    /// <list type="bullet">
    /// <item><c>mis.wvfd_weekly</c> — verified-farm-days per (farm, week),
    ///   53-week history. Source: <c>ssf.verification_events</c>
    ///   (<c>daily_log_id</c>, <c>occurred_at_utc</c>,
    ///   <c>status IN ('Confirmed','Verified')</c>).</item>
    /// <item><c>mis.log_verify_lag</c> — median hours from log creation
    ///   to first verification per farm, last 7 days.</item>
    /// <item><c>mis.correction_rate</c> — D2.A redefinition: % of last-7-day
    ///   <c>daily_logs</c> with at least one <c>verification_event</c>
    ///   having <c>status='Disputed'</c>. (Original Phase4 SQL counted
    ///   <c>daily_logs.is_corrected</c> — that column never existed.)</item>
    /// <item><c>mis.voice_log_share</c> — % of <c>log.created</c> events
    ///   with <c>trigger='voice'</c> per farm, last 7 days.</item>
    /// <item><c>mis.schedule_compliance_weekly</c> — S1 contract repair:
    ///   per-(farm, week) compliance % from
    ///   <c>analytics.events.props->>'complianceOutcome'</c>. The
    ///   earlier shape was groupby-week-only but
    ///   <c>MisReportRepository.GetFarmWeekMis</c> already joined on
    ///   <c>farm_id</c> — the matview was internally inconsistent
    ///   with its only consumer.</item>
    /// <item><c>mis.schedule_unscheduled_ratio</c> — % of <c>log.created</c>
    ///   events with <c>complianceOutcome='unscheduled'</c> per farm.</item>
    /// <item><c>mis.gemini_cost_per_farm</c> — total <c>cost_usd</c> from
    ///   <c>ai.invocation</c> events by (farm, day).</item>
    /// <item><c>mis.farmer_suffering_watchlist</c> — farms with 3+
    ///   error events (<c>api.error</c> / <c>client.error</c>) in the
    ///   last 7 days.</item>
    /// <item><c>mis.alert_r9_api_error_spike</c> — single-row breach
    ///   flag: <c>api.error</c> count &gt; 30 in the last hour.</item>
    /// <item><c>mis.alert_r10_voice_degraded</c> — single-row breach
    ///   flag: <c>ai.invocation</c> failure rate &gt; 20% in 6 hours.</item>
    /// </list>
    ///
    /// <para><b>Dropped, NOT recreated</b> — 22 matviews that were never
    /// queried by code OR were broken by fundamental design (e.g.
    /// joins to a non-existent <c>subscriptions.farm_id</c>):</para>
    /// <list type="bullet">
    /// <item><c>silent_churn_watchlist</c>, <c>zero_engagement_farms</c>
    ///   — required <c>subscription</c>→<c>farm</c> cross-aggregate
    ///   join that subscriptions don't carry.</item>
    /// <item><c>engagement_tier</c>, <c>activation_funnel</c>,
    ///   <c>d30_retention_paying</c>, <c>schedule_adoption_rate</c>,
    ///   <c>schedule_migration_rate</c>, <c>schedule_abandonment_rate</c>,
    ///   <c>feature_retention_lift</c>, <c>new_farm_day_snapshot</c>,
    ///   <c>activity_heatmap</c>, <c>cohort_quality_score</c> —
    ///   no production reader.</item>
    /// <item><c>alert_r1_smooth_decay</c>..<c>alert_r8_referral_quality</c>
    ///   (eight alerts) — no production reader; <c>AlertDispatcherJob</c>
    ///   only consumes R9 + R10.</item>
    /// <item><c>api_health_24h</c>, <c>voice_pipeline_health</c> —
    ///   labelled "Used by Metabase Card 13/14" in legacy comments;
    ///   no in-process reader. Metabase queries (if active) get a
    ///   "relation does not exist" until reintroduced via the redesign
    ///   follow-up.</item>
    /// </list>
    /// <para>
    /// All dropped matviews are tracked under
    /// <c>T-IGH-03-MIS-MATVIEW-REDESIGN</c> for reintroduction once a
    /// proper subscription→farm linking model exists. See _COFOUNDER
    /// pending-task index.
    /// </para>
    ///
    /// <para>
    /// <b>Idempotency.</b> Every destructive step uses <c>IF EXISTS</c>;
    /// schema and role bootstraps use <c>IF NOT EXISTS</c>. Replays of
    /// the migration are safe; running on a fresh DB or on a DB that
    /// already had the legacy matviews both succeed.
    /// </para>
    ///
    /// <para>
    /// <b>Forward-only.</b> <c>Down()</c> throws — rollback is via DB
    /// snapshot restore per
    /// <c>_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md</c>.
    /// Implementing inline restore of the prior matview definitions
    /// would copy ~150 lines of SQL from migrations we've just
    /// no-opped and would silently drift if those legacy bodies
    /// changed (they shouldn't, but the convention is forward-only).
    /// </para>
    /// </summary>
    public partial class AnalyticsRewrite : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- STEP 1: Schema + role bootstrap (idempotent)
-- The mis schema and mis_reader role were originally bootstrapped
-- by Phase4_MisSchemaRollups. Phase4 is now a no-op so the bootstrap
-- moves here. Pattern matches the canonical role-creation guard
-- documented in RDS_PROVISIONING.md.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS mis;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mis_reader') THEN
        CREATE ROLE mis_reader NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA mis TO mis_reader;
GRANT USAGE ON SCHEMA analytics TO mis_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA mis GRANT SELECT ON TABLES TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO mis_reader;


-- ============================================================
-- STEP 2: Drop ALL legacy matviews from the rewrite scope.
-- IF EXISTS keeps this idempotent: on a fresh DB nothing exists
-- to drop; on a prod DB that had the legacy versions, they go.
-- CASCADE handles inter-matview dependencies (R-views on bases).
-- ============================================================

-- Production-read set (recreated below with corrected SQL).
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly                 CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.log_verify_lag              CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.correction_rate             CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.voice_log_share             CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_compliance_weekly  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_unscheduled_ratio  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.gemini_cost_per_farm        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.farmer_suffering_watchlist  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r9_api_error_spike    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r10_voice_degraded    CASCADE;

-- Dropped set: never queried OR broken by design. Tracked under
-- T-IGH-03-MIS-MATVIEW-REDESIGN for proper reintroduction.
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.zero_engagement_farms       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier             CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.activation_funnel           CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.d30_retention_paying        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_adoption_rate      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_migration_rate     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_abandonment_rate   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.feature_retention_lift      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.new_farm_day_snapshot       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.activity_heatmap            CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.cohort_quality_score        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r1_smooth_decay       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r3_rubber_stamp       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r4_voice_decay        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r6_flash_churn        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r7_correction_rising  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r8_referral_quality   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.api_health_24h              CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.voice_pipeline_health       CASCADE;

-- Drop the prod-only ssf.verifications compat view if it still
-- exists (it was a manual hotfix on 2026-04-23; idempotent here).
DROP VIEW IF EXISTS ssf.verifications;


-- ============================================================
-- STEP 3: mis.wvfd_weekly — 53-week verified-farm-day count per
-- (farm, week). Verification status strings come from
-- VerificationStatus.HasConversion<string>() which stores the
-- enum's PascalCase name ('Confirmed', 'Verified', 'Disputed').
-- ============================================================
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


-- ============================================================
-- STEP 4: mis.log_verify_lag — median hours from log creation to
-- first verification event per farm, last 7 days. Replaces the
-- Phase4 join on the non-existent ssf.verifications table.
-- ============================================================
CREATE MATERIALIZED VIEW mis.log_verify_lag AS
SELECT
    l.farm_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (v.first_v - l.created_at_utc)) / 3600.0
    )::numeric(10, 2) AS median_hours_lag
FROM ssf.daily_logs l
JOIN LATERAL (
    SELECT MIN(occurred_at_utc) AS first_v
    FROM ssf.verification_events ve
    WHERE ve.daily_log_id = l.""Id""
) v ON v.first_v IS NOT NULL
WHERE l.created_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY l.farm_id;

CREATE UNIQUE INDEX ux_mis_log_verify_lag ON mis.log_verify_lag (farm_id);


-- ============================================================
-- STEP 5: mis.correction_rate — D2.A redefinition.
-- Original Phase4: COUNT(*) FILTER (WHERE l.is_corrected). That
-- column does not exist on ssf.daily_logs (it's a computed
-- property the EF model marks as Ignore'd). Redefined as: % of
-- last-7-day daily_logs that have at least one verification_event
-- with status='Disputed'. Same column shape (farm_id,
-- correction_rate_pct) so MisReportRepository's join is unchanged.
-- ============================================================
CREATE MATERIALIZED VIEW mis.correction_rate AS
SELECT
    l.farm_id,
    (COUNT(DISTINCT l.""Id"") FILTER (
        WHERE EXISTS (
            SELECT 1 FROM ssf.verification_events ve
            WHERE ve.daily_log_id = l.""Id""
              AND ve.status = 'Disputed'
        )
    ) * 100.0 / NULLIF(COUNT(DISTINCT l.""Id""), 0))::numeric(5, 2) AS correction_rate_pct
FROM ssf.daily_logs l
WHERE l.created_at_utc >= NOW() - INTERVAL '7 days'
GROUP BY l.farm_id;

CREATE UNIQUE INDEX ux_mis_correction_rate ON mis.correction_rate (farm_id);


-- ============================================================
-- STEP 6: mis.voice_log_share — % of last-7-day log.created events
-- with trigger='voice', per farm. Source columns
-- (event_type, trigger, farm_id, occurred_at_utc) match the live
-- analytics.events schema verbatim.
-- ============================================================
CREATE MATERIALIZED VIEW mis.voice_log_share AS
SELECT
    farm_id,
    (COUNT(*) FILTER (WHERE event_type = 'log.created' AND trigger = 'voice') * 100.0
     / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0))::numeric(5, 2)
        AS voice_share_pct
FROM analytics.events
WHERE occurred_at_utc >= NOW() - INTERVAL '7 days'
  AND farm_id IS NOT NULL
GROUP BY farm_id;

CREATE UNIQUE INDEX ux_mis_voice_log_share ON mis.voice_log_share (farm_id);


-- ============================================================
-- STEP 7: mis.schedule_compliance_weekly — S1 contract repair.
-- Per-(farm, week) compliance %. Earlier versions grouped only
-- by week, but MisReportRepository.GetFarmWeekMis already joined
-- on farm_id; the matview was internally inconsistent with its
-- only consumer. This rewrite restores the per-farm granularity
-- the consumer assumes.
-- ============================================================
CREATE MATERIALIZED VIEW mis.schedule_compliance_weekly AS
SELECT
    date_trunc('week', occurred_at_utc)::date AS week_start,
    farm_id,
    ROUND(
        COUNT(*) FILTER (WHERE props->>'complianceOutcome' = 'scheduled') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE props ? 'complianceOutcome'), 0)
    , 1) AS compliance_pct,
    COUNT(*) FILTER (WHERE props ? 'complianceOutcome') AS total_tracked_logs
FROM analytics.events
WHERE event_type = 'log.created'
  AND occurred_at_utc >= NOW() - INTERVAL '12 weeks'
  AND farm_id IS NOT NULL
GROUP BY date_trunc('week', occurred_at_utc), farm_id;

CREATE UNIQUE INDEX ux_mis_schedule_compliance_farm_week
    ON mis.schedule_compliance_weekly (farm_id, week_start);
CREATE        INDEX ix_mis_schedule_compliance_week
    ON mis.schedule_compliance_weekly (week_start DESC);


-- ============================================================
-- STEP 8: mis.schedule_unscheduled_ratio — % of log.created events
-- with complianceOutcome='unscheduled', per farm.
-- ============================================================
CREATE MATERIALIZED VIEW mis.schedule_unscheduled_ratio AS
SELECT
    farm_id,
    (SUM(CASE WHEN props->>'complianceOutcome' = 'unscheduled' THEN 1 ELSE 0 END) * 100.0
     / NULLIF(COUNT(*), 0))::numeric(5, 2) AS unscheduled_pct
FROM analytics.events
WHERE event_type = 'log.created'
  AND farm_id IS NOT NULL
GROUP BY farm_id;

CREATE UNIQUE INDEX ux_mis_schedule_unscheduled_ratio
    ON mis.schedule_unscheduled_ratio (farm_id);


-- ============================================================
-- STEP 9: mis.gemini_cost_per_farm — total cost_usd from
-- ai.invocation events by (farm, day). Filter rows lacking a
-- cost_usd prop so SUM(NUMERIC NULL) doesn't silently propagate.
-- ============================================================
CREATE MATERIALIZED VIEW mis.gemini_cost_per_farm AS
SELECT
    farm_id,
    DATE_TRUNC('day', occurred_at_utc)::date AS day,
    SUM(CAST(props->>'cost_usd' AS NUMERIC)) AS total_cost_usd
FROM analytics.events
WHERE event_type = 'ai.invocation'
  AND farm_id IS NOT NULL
  AND props ? 'cost_usd'
GROUP BY farm_id, DATE_TRUNC('day', occurred_at_utc);

CREATE UNIQUE INDEX ux_mis_gemini_cost ON mis.gemini_cost_per_farm (farm_id, day);


-- ============================================================
-- STEP 10: mis.farmer_suffering_watchlist — farms with 3+ error
-- events (api.error / client.error / ai.invocation failure) in
-- the last 7 days. Carried forward from Phase_OpsObservability
-- with no semantic change — that one's columns were already
-- correct.
-- ============================================================
CREATE MATERIALIZED VIEW mis.farmer_suffering_watchlist AS
SELECT
    farm_id,
    COUNT(*)                                                          AS error_count,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%sync%')         AS sync_errors,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%log%')          AS log_errors,
    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%voice%'
                       OR (event_type = 'ai.invocation'
                           AND props->>'outcome' = 'failure'))        AS voice_errors,
    COUNT(*) FILTER (WHERE event_type = 'client.error')              AS client_errors,
    MAX(occurred_at_utc)                                             AS last_error_at
FROM analytics.events
WHERE event_type IN ('api.error', 'client.error', 'ai.invocation')
  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
  AND farm_id IS NOT NULL
GROUP BY farm_id
HAVING COUNT(*) FILTER (
    WHERE event_type IN ('api.error', 'client.error')
       OR (event_type = 'ai.invocation' AND props->>'outcome' = 'failure')
) >= 3;

CREATE UNIQUE INDEX ux_mis_farmer_suffering ON mis.farmer_suffering_watchlist (farm_id);


-- ============================================================
-- STEP 11: mis.alert_r9_api_error_spike — single-row breach flag.
-- Read by AdminOpsRepository + AlertDispatcherJob.
-- ============================================================
CREATE MATERIALIZED VIEW mis.alert_r9_api_error_spike AS
SELECT
    1                                                                  AS id,
    'R9_api_error_spike'                                               AS detector,
    'More than 30 API errors in 1 hour — farmers are hitting a server bug'
                                                                       AS description,
    (COUNT(*) > 30)                                                    AS breached
FROM analytics.events
WHERE event_type = 'api.error'
  AND occurred_at_utc >= NOW() - INTERVAL '1 hour';

CREATE UNIQUE INDEX ux_mis_alert_r9 ON mis.alert_r9_api_error_spike (id);


-- ============================================================
-- STEP 12: mis.alert_r10_voice_degraded — single-row breach flag.
-- Read by AdminOpsRepository + AlertDispatcherJob.
-- ============================================================
CREATE MATERIALIZED VIEW mis.alert_r10_voice_degraded AS
SELECT
    1                                                                  AS id,
    'R10_voice_degraded'                                               AS detector,
    'Voice parse failure rate >20% in 6h — farmers cannot use voice logging'
                                                                       AS description,
    (COUNT(*) FILTER (WHERE props->>'outcome' = 'failure') * 100.0
     / NULLIF(COUNT(*), 0) > 20)                                      AS breached
FROM analytics.events
WHERE event_type = 'ai.invocation'
  AND occurred_at_utc >= NOW() - INTERVAL '6 hours';

CREATE UNIQUE INDEX ux_mis_alert_r10 ON mis.alert_r10_voice_degraded (id);


-- ============================================================
-- STEP 13: Permissions — grant SELECT on every new matview to
-- mis_reader (idempotent: GRANT is no-op if already granted).
-- ============================================================
GRANT SELECT ON mis.wvfd_weekly                 TO mis_reader;
GRANT SELECT ON mis.log_verify_lag              TO mis_reader;
GRANT SELECT ON mis.correction_rate             TO mis_reader;
GRANT SELECT ON mis.voice_log_share             TO mis_reader;
GRANT SELECT ON mis.schedule_compliance_weekly  TO mis_reader;
GRANT SELECT ON mis.schedule_unscheduled_ratio  TO mis_reader;
GRANT SELECT ON mis.gemini_cost_per_farm        TO mis_reader;
GRANT SELECT ON mis.farmer_suffering_watchlist  TO mis_reader;
GRANT SELECT ON mis.alert_r9_api_error_spike    TO mis_reader;
GRANT SELECT ON mis.alert_r10_voice_degraded    TO mis_reader;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Forward-only. Folding multiple broken legacy migrations
            // into a single canonical rebuild is intentionally
            // one-directional. Rollback is via DB snapshot restore
            // per _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    RAISE EXCEPTION 'Migration AnalyticsRewrite is forward-only. Rollback via DB snapshot restore (see _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md), not via dotnet ef database update.';
END
$$;
");
        }
    }
}
