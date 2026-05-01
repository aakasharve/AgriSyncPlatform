using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgriSync.Bootstrapper.Migrations.Analytics
{
    /// <summary>
    /// T-IGH-03-MIS-MATVIEW-REDESIGN Bucket 1 — restore the two
    /// subscription-aware admin churn-watch matviews on top of a new
    /// <c>mis.subscription_farms</c> denormalised projection.
    ///
    /// <para>
    /// <b>Decision provenance.</b> ADR-0004 (2026-05-01) accepted Option α —
    /// extend the <see cref="ShramSafal.Domain.Subscriptions.SubscriptionProjection"/>
    /// pattern with a single read-model artifact that performs the 4-hop
    /// link path (Subscription → OwnerAccount → OwnerAccountMembership
    /// → User → FarmMembership → Farm) once. Per the ADR's escape-hatch
    /// clause ("if production observation shows the per-refresh JOIN cost
    /// dominating MisRefreshJob runtime, promote subscription_farm_link
    /// to a materialized view"), this migration ships the link as a
    /// matview from the start: Bucket 1 has only two consumers but both
    /// need <c>REFRESH MATERIALIZED VIEW CONCURRENTLY</c> to participate
    /// in <c>MisRefreshJob</c>'s nightly cycle without holding writer
    /// locks. Refresh ordering enforced in <c>MisRefreshJob</c>:
    /// <c>subscription_farms</c> refreshes BEFORE its consumers.
    /// </para>
    ///
    /// <para>
    /// <b>Membership-status filters</b> (per ADR §"Membership-status caveats"):
    /// </para>
    /// <list type="bullet">
    /// <item><c>accounts.subscriptions.status IN (1, 2, 3)</c>
    ///   — Trialing (1), Active (2), PastDue (3). Excludes Expired (4),
    ///   Canceled (5), Suspended (6).</item>
    /// <item><c>accounts.owner_account_memberships.status = 1</c>
    ///   — Active only. Excludes Suspended (2), Revoked (3).</item>
    /// <item><c>ssf.farm_memberships.status = 3</c>
    ///   — Active only (per the
    ///   <see cref="ShramSafal.Domain.Farms.MembershipStatus"/> enum:
    ///   PendingOtpClaim=1, PendingApproval=2, Active=3, Suspended=4,
    ///   Revoked=5, Exited=6).</item>
    /// </list>
    ///
    /// <para>
    /// <b>Many-to-many fan-out</b> (per ADR consequences): one
    /// subscription resolves to N rows in <c>subscription_farms</c>
    /// because every Active OAM × every Active FM produces a row. The
    /// two consuming matviews aggregate (GROUP BY) — they do not assume
    /// 1:1.
    /// </para>
    ///
    /// <para>
    /// <b>Bucket 1 matviews shipped:</b>
    /// </para>
    /// <list type="bullet">
    /// <item><c>mis.subscription_farms</c> — denormalised link projection.
    ///   Columns: subscription_id, owner_account_id, plan_code,
    ///   subscription_status, valid_from_utc, valid_until_utc,
    ///   trial_ends_at_utc, subscription_started_at_utc, user_id,
    ///   farm_id, farm_name, farm_owner_account_id, oam_role, fm_role.</item>
    /// <item><c>mis.silent_churn_watchlist</c> — farms whose subscriptions are
    ///   Trialing/Active/PastDue but the farm has had no <c>log.created</c>
    ///   event in the last 14 days (the silent-churn signal). Joins
    ///   <c>subscription_farms</c> with <c>analytics.events</c>. Columns:
    ///   subscription_id, owner_account_id, farm_id, farm_name, plan_code,
    ///   subscription_status, subscription_started_at_utc, last_log_at,
    ///   days_since_last_log.</item>
    /// <item><c>mis.zero_engagement_farms</c> — farms with an active subscription
    ///   that have NEVER logged anything (no <c>log.created</c> event,
    ///   period). Columns: subscription_id, owner_account_id, farm_id,
    ///   farm_name, plan_code, subscription_status,
    ///   subscription_started_at_utc, days_since_subscription.</item>
    /// </list>
    ///
    /// <para>
    /// <b>Idempotency.</b> Drops use <c>IF EXISTS</c>; <c>CREATE MATERIALIZED
    /// VIEW IF NOT EXISTS</c> isn't supported in Postgres for matviews
    /// (regular views and tables only) so we drop-then-create. Index
    /// creation uses <c>CREATE UNIQUE INDEX</c> following the
    /// AnalyticsRewrite precedent. <c>GRANT SELECT</c> on the matviews
    /// is idempotent.
    /// </para>
    ///
    /// <para>
    /// <b>CONCURRENTLY refresh requires</b> at least one UNIQUE index per
    /// matview — provided here.
    /// </para>
    /// </summary>
    public partial class AddSubscriptionFarmsAndChurnMatviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
-- ============================================================
-- STEP 1: mis.subscription_farms — ADR-0004 α denormalised
-- read-model. Joins the 4-hop link path once so the two
-- consuming matviews (silent_churn_watchlist, zero_engagement_farms)
-- become simple GROUP-BYs against a known shape, not 30-line
-- JOINs each. Membership-status filters per ADR caveats.
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.subscription_farms CASCADE;

CREATE MATERIALIZED VIEW mis.subscription_farms AS
SELECT
    s.subscription_id           AS subscription_id,
    s.owner_account_id          AS owner_account_id,
    s.plan_code                 AS plan_code,
    s.status                    AS subscription_status,
    s.valid_from_utc            AS valid_from_utc,
    s.valid_until_utc           AS valid_until_utc,
    s.trial_ends_at_utc         AS trial_ends_at_utc,
    s.created_at_utc            AS subscription_started_at_utc,
    fm.user_id                  AS user_id,
    fm.farm_id                  AS farm_id,
    f.name                      AS farm_name,
    f.owner_account_id          AS farm_owner_account_id,
    oam.role                    AS oam_role,
    fm.role                     AS fm_role
FROM accounts.subscriptions s
JOIN accounts.owner_account_memberships oam
    ON oam.owner_account_id = s.owner_account_id
   AND oam.status = 1                     -- Active OAM only
JOIN ssf.farm_memberships fm
    ON fm.user_id = oam.user_id
   AND fm.status = 3                      -- Active FM only (MembershipStatus.Active = 3)
JOIN ssf.farms f
    ON f.""Id"" = fm.farm_id
WHERE s.status IN (1, 2, 3);              -- Trialing, Active, PastDue

-- CONCURRENTLY refresh requires a unique index. Composite key over
-- the natural identity of a row in the link projection: a (subscription, user, farm)
-- triple is unique because OAM is unique on (owner_account_id, user_id) for
-- active rows and FM is unique on (farm_id, user_id) for non-terminal rows.
CREATE UNIQUE INDEX ux_mis_subscription_farms
    ON mis.subscription_farms (subscription_id, user_id, farm_id);

CREATE INDEX ix_mis_subscription_farms_farm
    ON mis.subscription_farms (farm_id);

CREATE INDEX ix_mis_subscription_farms_owner_account
    ON mis.subscription_farms (owner_account_id);


-- ============================================================
-- STEP 2: mis.silent_churn_watchlist — farms on a paying or
-- trialing plan that haven't logged anything in 14 days.
-- Aggregates subscription_farms by (subscription_id, farm_id) so
-- the M:N fan-out doesn't produce duplicate rows per farm.
-- Consumer: AdminMisRepository.GetSilentChurnAsync (admin churn
-- dashboard).
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist CASCADE;

CREATE MATERIALIZED VIEW mis.silent_churn_watchlist AS
WITH last_log AS (
    SELECT
        farm_id,
        MAX(occurred_at_utc) AS last_log_at
    FROM analytics.events
    WHERE event_type = 'log.created'
      AND farm_id IS NOT NULL
    GROUP BY farm_id
),
sf AS (
    SELECT
        sf.subscription_id,
        sf.owner_account_id,
        sf.farm_id,
        MIN(sf.farm_name)                   AS farm_name,
        MIN(sf.plan_code)                   AS plan_code,
        MIN(sf.subscription_status)         AS subscription_status,
        MIN(sf.subscription_started_at_utc) AS subscription_started_at_utc
    FROM mis.subscription_farms sf
    GROUP BY sf.subscription_id, sf.owner_account_id, sf.farm_id
)
SELECT
    sf.subscription_id,
    sf.owner_account_id,
    sf.farm_id,
    sf.farm_name,
    sf.plan_code,
    sf.subscription_status,
    sf.subscription_started_at_utc,
    ll.last_log_at,
    EXTRACT(DAY FROM (NOW() - ll.last_log_at))::int AS days_since_last_log
FROM sf
JOIN last_log ll ON ll.farm_id = sf.farm_id
WHERE ll.last_log_at < NOW() - INTERVAL '14 days';

CREATE UNIQUE INDEX ux_mis_silent_churn
    ON mis.silent_churn_watchlist (subscription_id, farm_id);

CREATE INDEX ix_mis_silent_churn_owner_account
    ON mis.silent_churn_watchlist (owner_account_id);


-- ============================================================
-- STEP 3: mis.zero_engagement_farms — farms with an active
-- subscription that have NEVER logged anything. Distinct from
-- silent-churn (which requires a prior log followed by silence).
-- LEFT JOIN to last_log + WHERE last_log_at IS NULL is the
-- standard 'never-happened' pattern.
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mis.zero_engagement_farms CASCADE;

CREATE MATERIALIZED VIEW mis.zero_engagement_farms AS
WITH last_log AS (
    SELECT
        farm_id,
        MAX(occurred_at_utc) AS last_log_at
    FROM analytics.events
    WHERE event_type = 'log.created'
      AND farm_id IS NOT NULL
    GROUP BY farm_id
),
sf AS (
    SELECT
        sf.subscription_id,
        sf.owner_account_id,
        sf.farm_id,
        MIN(sf.farm_name)                   AS farm_name,
        MIN(sf.plan_code)                   AS plan_code,
        MIN(sf.subscription_status)         AS subscription_status,
        MIN(sf.subscription_started_at_utc) AS subscription_started_at_utc
    FROM mis.subscription_farms sf
    GROUP BY sf.subscription_id, sf.owner_account_id, sf.farm_id
)
SELECT
    sf.subscription_id,
    sf.owner_account_id,
    sf.farm_id,
    sf.farm_name,
    sf.plan_code,
    sf.subscription_status,
    sf.subscription_started_at_utc,
    EXTRACT(DAY FROM (NOW() - sf.subscription_started_at_utc))::int
        AS days_since_subscription
FROM sf
LEFT JOIN last_log ll ON ll.farm_id = sf.farm_id
WHERE ll.last_log_at IS NULL;

CREATE UNIQUE INDEX ux_mis_zero_engagement
    ON mis.zero_engagement_farms (subscription_id, farm_id);

CREATE INDEX ix_mis_zero_engagement_owner_account
    ON mis.zero_engagement_farms (owner_account_id);


-- ============================================================
-- STEP 4: Permissions — grant SELECT on the new matviews to
-- mis_reader (idempotent: GRANT is a no-op if already granted).
-- ============================================================
GRANT SELECT ON mis.subscription_farms       TO mis_reader;
GRANT SELECT ON mis.silent_churn_watchlist   TO mis_reader;
GRANT SELECT ON mis.zero_engagement_farms    TO mis_reader;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Forward-only migration chain (matching AnalyticsRewrite's
            // convention). Rollback is via DB snapshot restore per
            // _COFOUNDER/OS/Protocols/Deploy/RDS_PROVISIONING.md, not
            // via dotnet ef database update. Reverse-order DROPs are
            // listed for completeness and for ad-hoc cleanup in dev.
            migrationBuilder.Sql(@"
DROP MATERIALIZED VIEW IF EXISTS mis.zero_engagement_farms   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.silent_churn_watchlist  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mis.subscription_farms      CASCADE;
");
        }
    }
}
