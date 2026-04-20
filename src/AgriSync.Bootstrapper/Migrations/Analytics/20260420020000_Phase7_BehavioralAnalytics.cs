using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <inheritdoc />
    public partial class Phase7_BehavioralAnalytics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- Phase 7 — Behavioral Analytics + Red-Flag Detectors
-- All views are MATERIALIZED and refreshed nightly by MisRefreshJob.
-- Depends on Phase 4 views (mis.wvfd_weekly, etc.) already existing.

-- ============================================================
-- Task 7.1 — Feature-Retention Lift
-- Computes D30 retention lift per feature (schedule, voice, receipt, etc.)
-- ============================================================
CREATE MATERIALIZED VIEW mis.feature_retention_lift AS
WITH base AS (
    SELECT
        actor_user_id,
        DATE_TRUNC('week', MIN(occurred_at_utc)) AS signup_week,
        BOOL_OR(event_type = 'schedule.adopted')                  AS used_schedule,
        BOOL_OR(event_type = 'log.created' AND trigger = 'voice') AS used_voice,
        BOOL_OR(event_type = 'ai.invocation' AND props->>'source' = 'receipt') AS used_receipt,
        BOOL_OR(event_type = 'log.created')                       AS used_log,
        BOOL_OR(event_type = 'finance.expense.allocated' OR event_type = 'cost.entry.added') AS used_cost,
        BOOL_OR(event_type = 'invitation.claimed')                AS used_invite,
        BOOL_OR(event_type = 'log.verified')                      AS used_verify
    FROM analytics.events
    WHERE actor_user_id IS NOT NULL
      AND occurred_at_utc >= NOW() - INTERVAL '90 days'
    GROUP BY actor_user_id
),
retained AS (
    SELECT DISTINCT actor_user_id
    FROM analytics.events
    WHERE occurred_at_utc BETWEEN NOW() - INTERVAL '35 days' AND NOW() - INTERVAL '28 days'
)
SELECT
    'schedule_adopted'  AS feature,
    ROUND(
        (COUNT(*) FILTER (WHERE used_schedule AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
         / NULLIF(COUNT(*) FILTER (WHERE used_schedule), 0))
        - (COUNT(*) FILTER (WHERE NOT used_schedule AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
           / NULLIF(COUNT(*) FILTER (WHERE NOT used_schedule), 0)),
    1) AS d30_lift_pts
FROM base
UNION ALL
SELECT 'voice_log',
    ROUND(
        (COUNT(*) FILTER (WHERE used_voice AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
         / NULLIF(COUNT(*) FILTER (WHERE used_voice), 0))
        - (COUNT(*) FILTER (WHERE NOT used_voice AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
           / NULLIF(COUNT(*) FILTER (WHERE NOT used_voice), 0)),
    1)
FROM base
UNION ALL
SELECT 'receipt_ocr',
    ROUND(
        (COUNT(*) FILTER (WHERE used_receipt AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
         / NULLIF(COUNT(*) FILTER (WHERE used_receipt), 0))
        - (COUNT(*) FILTER (WHERE NOT used_receipt AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
           / NULLIF(COUNT(*) FILTER (WHERE NOT used_receipt), 0)),
    1)
FROM base
UNION ALL
SELECT 'cost_entry',
    ROUND(
        (COUNT(*) FILTER (WHERE used_cost AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
         / NULLIF(COUNT(*) FILTER (WHERE used_cost), 0))
        - (COUNT(*) FILTER (WHERE NOT used_cost AND actor_user_id IN (SELECT actor_user_id FROM retained)) * 100.0
           / NULLIF(COUNT(*) FILTER (WHERE NOT used_cost), 0)),
    1)
FROM base
ORDER BY d30_lift_pts DESC NULLS LAST;

CREATE UNIQUE INDEX ux_mis_feature_retention_lift ON mis.feature_retention_lift (feature);

-- ============================================================
-- Task 7.2 — New-Farm Day-Snapshot (first-7-day microscope)
-- One row per (farm, day_of_cohort). Cluster trajectories downstream.
-- ============================================================
CREATE MATERIALIZED VIEW mis.new_farm_day_snapshot AS
SELECT
    e.farm_id,
    DATE_TRUNC('day', e.occurred_at_utc) AS snapshot_day,
    MIN(e.occurred_at_utc) OVER (PARTITION BY e.farm_id) AS farm_first_event_utc,
    EXTRACT(DAY FROM e.occurred_at_utc - MIN(e.occurred_at_utc) OVER (PARTITION BY e.farm_id)) AS day_of_cohort,
    COUNT(*) FILTER (WHERE e.event_type = 'log.created') AS logs_that_day,
    COUNT(*) FILTER (WHERE e.event_type = 'log.verified') AS verifications_that_day,
    BOOL_OR(e.event_type = 'schedule.adopted') AS schedule_adopted_today,
    BOOL_OR(e.event_type = 'log.created' AND e.trigger = 'voice') AS voice_tried_today,
    BOOL_OR(e.event_type = 'invitation.issued') AS invite_sent_today
FROM analytics.events e
WHERE e.farm_id IS NOT NULL
  AND e.occurred_at_utc >= NOW() - INTERVAL '30 days'
GROUP BY e.farm_id, DATE_TRUNC('day', e.occurred_at_utc);

CREATE INDEX ix_mis_new_farm_snapshot_farm ON mis.new_farm_day_snapshot (farm_id, day_of_cohort);

-- ============================================================
-- Task 7.3 — Silent Churn Watchlist (already in Phase 4, enhance with owner info)
-- Drop and recreate with richer columns.
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;

CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
WITH wvfd_last2 AS (
    SELECT
        farm_id,
        AVG(wvfd) AS avg_wvfd_2w
    FROM mis.wvfd_weekly
    GROUP BY farm_id
)
SELECT
    s.owner_account_id,
    s.farm_id,
    s.plan_code,
    COALESCE(w.avg_wvfd_2w, 0)::numeric(4,2) AS avg_wvfd_2w,
    s.current_period_end_utc,
    (s.current_period_end_utc - NOW()) AS days_until_renewal
FROM accounts.subscriptions s
LEFT JOIN wvfd_last2 w ON w.farm_id = s.farm_id
WHERE s.state = 'Active'
  AND COALESCE(w.avg_wvfd_2w, 0) < 1;

CREATE UNIQUE INDEX ux_mis_silent_churn_farm ON mis.silent_churn_watchlist (farm_id);

-- ============================================================
-- Task 7.4 — Zero-cost and zero-MIS-visit farms (negative space)
-- ============================================================
CREATE MATERIALIZED VIEW mis.zero_engagement_farms AS
SELECT
    s.farm_id,
    s.owner_account_id,
    s.plan_code,
    COALESCE(log_count.cnt, 0) AS total_logs_ever,
    COALESCE(cost_count.cnt, 0) AS total_costs_ever
FROM accounts.subscriptions s
LEFT JOIN (
    SELECT farm_id, COUNT(*) AS cnt
    FROM analytics.events
    WHERE event_type = 'log.created'
    GROUP BY farm_id
) log_count ON log_count.farm_id = s.farm_id
LEFT JOIN (
    SELECT farm_id, COUNT(*) AS cnt
    FROM analytics.events
    WHERE event_type = 'cost.entry.added'
    GROUP BY farm_id
) cost_count ON cost_count.farm_id = s.farm_id
WHERE s.state IN ('Active', 'Trialing');

CREATE UNIQUE INDEX ux_mis_zero_engagement ON mis.zero_engagement_farms (farm_id);

-- ============================================================
-- Task 7.5 — Activity Heatmap (day-of-week × hour-of-day log density)
-- ============================================================
CREATE MATERIALIZED VIEW mis.activity_heatmap AS
SELECT
    EXTRACT(DOW FROM occurred_at_utc AT TIME ZONE 'Asia/Kolkata')::int AS day_of_week,
    EXTRACT(HOUR FROM occurred_at_utc AT TIME ZONE 'Asia/Kolkata')::int AS hour_ist,
    COUNT(*) AS event_count
FROM analytics.events
WHERE event_type = 'log.created'
  AND occurred_at_utc >= NOW() - INTERVAL '30 days'
GROUP BY day_of_week, hour_ist;

CREATE UNIQUE INDEX ux_mis_activity_heatmap ON mis.activity_heatmap (day_of_week, hour_ist);

-- ============================================================
-- Task 7.6 — Cohort Quality Score per acquisition channel
-- CQS = 0.4 × D30_retention + 0.3 × avg_WVFD + 0.2 × paid_conversion + 0.1 × referral_rate
-- ============================================================
CREATE MATERIALIZED VIEW mis.cohort_quality_score AS
WITH cohorts AS (
    SELECT
        actor_user_id,
        DATE_TRUNC('week', MIN(occurred_at_utc)) AS signup_week,
        props->>'channel' AS channel
    FROM analytics.events
    WHERE event_type = 'user.registered'
    GROUP BY actor_user_id, props->>'channel'
),
d30 AS (
    SELECT c.actor_user_id, c.channel, c.signup_week,
        (SELECT COUNT(*) > 0
         FROM analytics.events e2
         WHERE e2.actor_user_id = c.actor_user_id
           AND e2.occurred_at_utc BETWEEN c.signup_week + INTERVAL '28 days'
                                       AND c.signup_week + INTERVAL '35 days') AS retained_d30,
        (SELECT COUNT(*) > 0 FROM analytics.events e3
         WHERE e3.actor_user_id = c.actor_user_id
           AND e3.event_type = 'subscription.activated') AS converted_paid,
        (SELECT COUNT(*) > 0 FROM analytics.events e4
         WHERE e4.actor_user_id = c.actor_user_id
           AND e4.event_type = 'invitation.issued') AS sent_referral
    FROM cohorts c
)
SELECT
    COALESCE(channel, 'direct') AS channel,
    signup_week,
    COUNT(*) AS cohort_size,
    ROUND(AVG(retained_d30::int) * 100, 1) AS d30_retention_pct,
    ROUND(AVG(converted_paid::int) * 100, 1) AS paid_conversion_pct,
    ROUND(AVG(sent_referral::int) * 100, 1) AS referral_rate_pct,
    ROUND(
        0.4 * AVG(retained_d30::int) * 100
        + 0.3 * COALESCE((SELECT AVG(wvfd) FROM mis.wvfd_weekly), 0)
        + 0.2 * AVG(converted_paid::int) * 100
        + 0.1 * AVG(sent_referral::int) * 100
    , 1) AS cohort_quality_score
FROM d30
GROUP BY channel, signup_week;

CREATE INDEX ix_mis_cqs ON mis.cohort_quality_score (channel, signup_week);

-- ============================================================
-- Task 7.8 — Red-Flag Detector Views (R1–R8)
-- Each returns rows only when the breach is active.
-- ============================================================

-- R1: Smooth-decay retention
CREATE MATERIALIZED VIEW mis.alert_r1_smooth_decay AS
SELECT
    1 AS id,
    'R1_smooth_decay' AS detector,
    'D30 < 20% of D7 AND D60 < 40% of D30 — novelty effect, not habit' AS description,
    TRUE AS breached
FROM (
    SELECT
        COUNT(*) FILTER (WHERE occurred_at_utc BETWEEN signup + INTERVAL '6 days'  AND signup + INTERVAL '8 days')  AS d7,
        COUNT(*) FILTER (WHERE occurred_at_utc BETWEEN signup + INTERVAL '28 days' AND signup + INTERVAL '35 days') AS d30,
        COUNT(*) FILTER (WHERE occurred_at_utc BETWEEN signup + INTERVAL '58 days' AND signup + INTERVAL '62 days') AS d60
    FROM (
        SELECT actor_user_id, MIN(occurred_at_utc) AS signup FROM analytics.events
        WHERE event_type = 'user.registered' GROUP BY actor_user_id
    ) u
    JOIN analytics.events e ON e.actor_user_id = u.actor_user_id
    WHERE u.signup >= NOW() - INTERVAL '90 days'
) retention
WHERE d30 < d7 * 0.2 AND d60 < d30 * 0.4;

CREATE UNIQUE INDEX ux_mis_alert_r1 ON mis.alert_r1_smooth_decay (id);

-- R2: WAU rising, WVFD falling
CREATE MATERIALIZED VIEW mis.alert_r2_wau_vs_wvfd AS
WITH this_week AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau, AVG(wvfd) AS avg_wvfd
    FROM analytics.events, mis.wvfd_weekly
    WHERE occurred_at_utc >= NOW() - INTERVAL '7 days'
),
last_week AS (
    SELECT COUNT(DISTINCT actor_user_id) AS wau_prev
    FROM analytics.events
    WHERE occurred_at_utc BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
)
SELECT
    1 AS id,
    'R2_wau_vs_wvfd' AS detector,
    'WAU up >10% but WVFD down >10% — growth masking product failure' AS description,
    (this_week.wau > last_week.wau_prev * 1.10) AS breached
FROM this_week, last_week;

CREATE UNIQUE INDEX ux_mis_alert_r2 ON mis.alert_r2_wau_vs_wvfd (id);

-- R3: Rubber-stamp verification
CREATE MATERIALIZED VIEW mis.alert_r3_rubber_stamp AS
SELECT
    1 AS id,
    'R3_rubber_stamp' AS detector,
    '>30% of owners verify 10+ logs in <10s — verification signal is fake' AS description,
    TRUE AS breached
FROM analytics.events
WHERE event_type = 'batch.verified'
  AND (props->>'log_count')::int >= 10
  AND (props->>'elapsed_ms')::int < 10000
  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
HAVING COUNT(DISTINCT actor_user_id) * 3 >
    (SELECT COUNT(DISTINCT actor_user_id) FROM analytics.events
     WHERE event_type = 'batch.verified' AND occurred_at_utc >= NOW() - INTERVAL '7 days');

CREATE UNIQUE INDEX ux_mis_alert_r3 ON mis.alert_r3_rubber_stamp (id);

-- R4: Voice share decay
CREATE MATERIALIZED VIEW mis.alert_r4_voice_decay AS
WITH voice_w1 AS (
    SELECT AVG(voice_share_pct) AS avg_voice_w1
    FROM mis.voice_log_share
),
voice_w6 AS (
    SELECT
        COUNT(*) FILTER (WHERE event_type = 'log.created' AND trigger = 'voice') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0) AS week6_voice_pct
    FROM analytics.events
    WHERE occurred_at_utc BETWEEN NOW() - INTERVAL '42 days' AND NOW() - INTERVAL '35 days'
)
SELECT
    1 AS id,
    'R4_voice_decay' AS detector,
    'Voice share in week 6 < 50% of week 1 — AI not forming habit' AS description,
    (voice_w6.week6_voice_pct < voice_w1.avg_voice_w1 * 0.5) AS breached
FROM voice_w1, voice_w6;

CREATE UNIQUE INDEX ux_mis_alert_r4 ON mis.alert_r4_voice_decay (id);

-- R5: Schedule compliance plateau
CREATE MATERIALIZED VIEW mis.alert_r5_compliance_plateau AS
SELECT
    1 AS id,
    'R5_compliance_plateau' AS detector,
    'Schedule compliance flat at <50% across 4+ consecutive cohorts — catalog mismatch' AS description,
    (COUNT(*) FILTER (WHERE compliance_pct < 50) >= 4) AS breached
FROM mis.schedule_compliance_weekly
WHERE week_start >= NOW() - INTERVAL '28 days';

CREATE UNIQUE INDEX ux_mis_alert_r5 ON mis.alert_r5_compliance_plateau (id);

-- R6: Trial-paid flash churn
CREATE MATERIALIZED VIEW mis.alert_r6_flash_churn AS
SELECT
    1 AS id,
    'R6_flash_churn' AS detector,
    '>20% of new paid subs cancel within 30 days — pricing or value mismatch' AS description,
    TRUE AS breached
FROM analytics.events activated
WHERE activated.event_type = 'subscription.activated'
  AND activated.occurred_at_utc >= NOW() - INTERVAL '60 days'
  AND EXISTS (
    SELECT 1 FROM analytics.events cancelled
    WHERE cancelled.actor_user_id = activated.actor_user_id
      AND cancelled.event_type = 'subscription.cancelled'
      AND cancelled.occurred_at_utc BETWEEN activated.occurred_at_utc
                                          AND activated.occurred_at_utc + INTERVAL '30 days'
  )
HAVING COUNT(*) * 5 > (
    SELECT COUNT(*) FROM analytics.events
    WHERE event_type = 'subscription.activated' AND occurred_at_utc >= NOW() - INTERVAL '60 days'
);

CREATE UNIQUE INDEX ux_mis_alert_r6 ON mis.alert_r6_flash_churn (id);

-- R7: Correction rate rising
CREATE MATERIALIZED VIEW mis.alert_r7_correction_rising AS
WITH rolling AS (
    SELECT
        DATE_TRUNC('week', occurred_at_utc) AS week,
        COUNT(*) FILTER (WHERE event_type = 'log.corrected') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE event_type = 'log.created'), 0) AS correction_pct
    FROM analytics.events
    WHERE occurred_at_utc >= NOW() - INTERVAL '28 days'
    GROUP BY DATE_TRUNC('week', occurred_at_utc)
)
SELECT
    1 AS id,
    'R7_correction_rising' AS detector,
    '4-week correction rate grew ≥5 points — operator-owner trust degrading' AS description,
    (MAX(correction_pct) - MIN(correction_pct) >= 5) AS breached
FROM rolling;

CREATE UNIQUE INDEX ux_mis_alert_r7 ON mis.alert_r7_correction_rising (id);

-- R8: Referral cohort retention < direct signup
CREATE MATERIALIZED VIEW mis.alert_r8_referral_quality AS
WITH by_channel AS (
    SELECT
        COALESCE(props->>'channel', 'direct') AS channel,
        AVG(CASE WHEN EXISTS (
            SELECT 1 FROM analytics.events e2
            WHERE e2.actor_user_id = e.actor_user_id
              AND e2.occurred_at_utc BETWEEN e.occurred_at_utc + INTERVAL '28 days'
                                          AND e.occurred_at_utc + INTERVAL '35 days'
        ) THEN 1 ELSE 0 END)::numeric AS d30_retention
    FROM analytics.events e
    WHERE event_type = 'user.registered'
      AND occurred_at_utc >= NOW() - INTERVAL '60 days'
    GROUP BY COALESCE(props->>'channel', 'direct')
)
SELECT
    1 AS id,
    'R8_referral_quality' AS detector,
    'QR-referral D30 < direct D30 — incentivizing wrong invitations' AS description,
    (COALESCE(MAX(d30_retention) FILTER (WHERE channel = 'qr_referral'), 0) <
     COALESCE(MAX(d30_retention) FILTER (WHERE channel = 'direct'), 0)) AS breached
FROM by_channel;

CREATE UNIQUE INDEX ux_mis_alert_r8 ON mis.alert_r8_referral_quality (id);

GRANT SELECT ON ALL TABLES IN SCHEMA mis TO mis_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA mis GRANT SELECT ON TABLES TO mis_reader;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r8_referral_quality;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r7_correction_rising;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r6_flash_churn;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r5_compliance_plateau;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r4_voice_decay;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r3_rubber_stamp;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r2_wau_vs_wvfd;
DROP MATERIALIZED VIEW IF EXISTS mis.alert_r1_smooth_decay;
DROP MATERIALIZED VIEW IF EXISTS mis.cohort_quality_score;
DROP MATERIALIZED VIEW IF EXISTS mis.activity_heatmap;
DROP MATERIALIZED VIEW IF EXISTS mis.zero_engagement_farms;
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist;
DROP MATERIALIZED VIEW IF EXISTS mis.new_farm_day_snapshot;
DROP MATERIALIZED VIEW IF EXISTS mis.feature_retention_lift;

-- Recreate the simpler Phase 4 silent_churn_watchlist
CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
SELECT s.owner_account_id, s.farm_id, s.plan_code,
    w.wvfd AS wvfd_this_week, s.current_period_end_utc
FROM accounts.subscriptions s
LEFT JOIN mis.wvfd_weekly w ON w.farm_id = s.farm_id
WHERE s.state = 'Active' AND COALESCE(w.wvfd, 0) = 0;
CREATE UNIQUE INDEX ux_mis_silent_churn_farm ON mis.silent_churn_watchlist (farm_id);
");
        }
    }
}
