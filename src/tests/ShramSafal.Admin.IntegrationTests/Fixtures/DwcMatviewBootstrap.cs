using System.Data.Common;
using Npgsql;

namespace ShramSafal.Admin.IntegrationTests.Fixtures;

/// <summary>
/// One-shot, idempotent bootstrap for the four DWC v2 matviews shipped
/// by <c>20260505000000_DwcV2Matviews</c>, applied directly against the
/// <see cref="AdminTestFixture"/>'s test database.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b> <see cref="AdminTestFixture"/> wires
/// <see cref="AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext"/>
/// via <c>EnsureCreatedAsync</c> (not <c>MigrateAsync</c>) — the
/// EF-model path. EnsureCreated builds the <c>analytics.events</c>
/// table from the CLR model but knows nothing about the matview SQL
/// in <c>Migrations/Analytics/</c>. Tests that need the DWC v2
/// matviews to exist (<see cref="ModeALatencyBudgetTests"/>,
/// <see cref="AntiGamingDetectionTests"/>) call
/// <see cref="EnsureMatviewsAsync"/> once at startup to materialise
/// just the matview SQL the gaming-signals + score paths require.
/// </para>
/// <para>
/// <b>Why not MigrateAsync.</b> Running analytics migrations would
/// require setting <c>MigrationsAssembly</c> + a separate migrations
/// history table on the AdminTestFixture's <c>AnalyticsDbContext</c>,
/// then reconciling with the EnsureCreated-backed
/// <c>analytics.events</c> table the fixture already created. That
/// reconciliation is the work the original AdminTestFixture
/// deliberately deferred ("uses EnsureCreated (no migrations), which
/// no-ops on a DB that already has ANY tables"). Re-creating the
/// matviews via raw SQL — same DDL the migration applies, verbatim —
/// is the smallest reversible delta that doesn't touch the shipped
/// fixture.
/// </para>
/// <para>
/// <b>Idempotency.</b> Each <c>CREATE MATERIALIZED VIEW</c> is
/// preceded by <c>DROP MATERIALIZED VIEW IF EXISTS … CASCADE</c> —
/// matches the migration's own pattern, so multiple test runs against
/// the same per-fixture DB are safe.
/// </para>
/// <para>
/// <b>SQL provenance.</b> The DDL is the gaming-signals matview from
/// <c>20260505000000_DwcV2Matviews.cs</c> verbatim. Two upstream
/// matviews the score view joins (<c>mis.wvfd_weekly</c>,
/// <c>mis.schedule_compliance_weekly</c>) are not bootstrapped here —
/// the gaming_signals matview reads only <c>ssf.daily_logs</c> and
/// <c>ssf.verification_events</c>, both of which the fixture's SSF
/// migrations already create. The <c>mis</c> schema is created
/// upstream by an SSF migration (<c>AddEffectiveOrgFarmScopeMisTable</c>);
/// we issue <c>CREATE SCHEMA IF NOT EXISTS</c> defensively.
/// </para>
/// </remarks>
internal static class DwcMatviewBootstrap
{
    /// <summary>
    /// Creates (or recreates) the gaming_signals matview against the
    /// supplied connection string. Safe to call multiple times.
    /// </summary>
    public static async Task EnsureGamingSignalsMatviewAsync(string connectionString, CancellationToken ct = default)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);
        await ApplySqlAsync(conn, EnsureMisSchemaSql, ct);
        await ApplySqlAsync(conn, GamingSignalsMatviewSql, ct);
    }

    private static async Task ApplySqlAsync(DbConnection conn, string sql, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private const string EnsureMisSchemaSql = @"CREATE SCHEMA IF NOT EXISTS mis;";

    /// <summary>
    /// Verbatim copy of the gaming_signals matview DDL from
    /// <c>20260505000000_DwcV2Matviews.cs</c>. Kept in lockstep — any
    /// edit to that migration's gaming-signals CTE must be mirrored
    /// here (or the bootstrap reverts to stale SQL).
    /// </summary>
    private const string GamingSignalsMatviewSql = @"
DROP MATERIALIZED VIEW IF EXISTS mis.gaming_signals_per_farm CASCADE;
CREATE MATERIALIZED VIEW mis.gaming_signals_per_farm AS
WITH gps_clusters AS (
  SELECT farm_id, FALSE::boolean AS signal_gps_static
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
FULL OUTER JOIN perfect_record p USING (farm_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mis_gaming_signals
  ON mis.gaming_signals_per_farm (farm_id);
";
}
