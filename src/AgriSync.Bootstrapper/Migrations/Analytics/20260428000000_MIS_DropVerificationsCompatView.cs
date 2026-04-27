using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// T-PROD-DB-OOB-TRACK follow-up — fold the prod-only `ssf.verifications`
    /// compat view (created interactively during the 2026-04-23 deploy) into
    /// the migration history so a fresh DB needs zero manual SQL.
    ///
    /// Strategy:
    ///   1. Drop the matviews from MIS_MatViewHealthFix that join the compat view.
    ///   2. Recreate them using the real `ssf.verification_events` table directly
    ///      (column rename: `log_id` -> `daily_log_id`,
    ///                       `verified_at_utc` -> `occurred_at_utc`).
    ///   3. Drop the compat view itself (`ssf.verifications`).
    ///   4. Re-grant SELECT on the recreated matviews to `mis_reader` (with
    ///      idempotent CREATE ROLE guard so the migration is self-contained).
    ///
    /// After this migration applies, no migration in the analytics chain depends
    /// on `ssf.verifications`. The `mis_reader` role is bootstrapped by
    /// `Phase4_MisSchemaRollups` and re-asserted defensively here, so a fresh
    /// DB needs zero manual SQL. Background on the role:
    /// `_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md`.
    ///
    /// This migration is **forward-only**. Down() throws — rollback is via DB
    /// snapshot restore, not via `dotnet ef database update &lt;prev&gt;`. Reason:
    /// implementing complete inline restoration of all 7 dropped matviews
    /// would copy ~150 lines of SQL from MIS_MatViewHealthFix and drift as
    /// those definitions evolve. Snapshot restore is the prod rollback path
    /// per `_COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md` anyway.
    /// </summary>
    public partial class MIS_DropVerificationsCompatView : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- STEP 1: Drop matviews that join ssf.verifications (reverse-dep order)
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau;
DROP MATERIALIZED VIEW IF EXISTS mis.schedule_compliance_weekly;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd;
DROP MATERIALIZED VIEW IF EXISTS mis.cohort_quality_score;
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;
DROP MATERIALIZED VIEW IF EXISTS mis.engagement_tier;
DROP MATERIALIZED VIEW IF EXISTS mis.wvfd_weekly;


-- ============================================================
-- STEP 2: Recreate mis.wvfd_weekly using ssf.verification_events directly
-- (column rename: log_id -> daily_log_id, verified_at_utc -> occurred_at_utc)
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
            AND v.status IN ('confirmed', 'verified')
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
-- STEP 3: mis.engagement_tier (unchanged from MIS_MatViewHealthFix)
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
-- STEP 4: mis.silent_churn_watchlist (unchanged — uses mis.wvfd_weekly)
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
-- STEP 5: mis.cohort_quality_score (unchanged — uses mis.wvfd_weekly)
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
-- STEP 6: mis.alert_r2_wau_vs_wvfd (unchanged — uses mis.wvfd_weekly)
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
-- STEP 7: mis.schedule_compliance_weekly (unchanged — analytics events only)
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
-- STEP 8: mis.alert_r5_compliance_plateau (unchanged)
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
-- STEP 9: Drop the prod-only ssf.verifications compat view
-- ============================================================
DROP VIEW IF EXISTS ssf.verifications;


-- ============================================================
-- STEP 10: Permissions — grant SELECT on recreated matviews to mis_reader
-- The role is bootstrapped by Phase4_MisSchemaRollups (runs earlier in the
-- chain). We re-assert it here defensively so the migration is self-
-- contained and never fails on a partially-provisioned DB.
-- Pattern mirrors Phase4_MisSchemaRollups (the canonical guard).
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mis_reader') THEN
        CREATE ROLE mis_reader NOLOGIN;
    END IF;
END
$$;

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
            // Forward-only migration. Folding an interactive prod hotfix into
            // the chain is intentionally one-directional. To unwind:
            //   1. Restore from the most recent RDS snapshot taken before
            //      this migration applied (per RDS_PROVISIONING.md).
            //   2. Re-pin the analytics chain at MIS_MatViewHealthFix in
            //      Bootstrapper config.
            // We do NOT inline 7 matview definitions in Down() because that
            // would copy ~150 lines from MIS_MatViewHealthFix and silently
            // drift as the canonical definitions evolve in future migrations.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    RAISE EXCEPTION 'Migration MIS_DropVerificationsCompatView is forward-only. Rollback via DB snapshot restore (see _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md), not via dotnet ef database update.';
END
$$;
");
        }
    }
}
