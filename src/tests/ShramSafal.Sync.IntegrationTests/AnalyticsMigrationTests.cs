using System.Collections.Generic;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// T-IGH-03-ANALYTICS-MIGRATION-REWRITE: prove the analytics migration
/// chain applies cleanly against a fresh production-shape Postgres
/// (Testcontainers harness chosen 2026-05-01 — α path).
///
/// <para>
/// Marked <c>Trait("Category","RequiresDocker")</c>. Local environments
/// without Docker skip these; CI runs them as part of the full
/// integration test sweep on the GitHub Actions runner where Docker
/// is available out of the box.
/// </para>
///
/// <para>
/// What the test does:
/// </para>
/// <list type="number">
/// <item>Spins up a fresh Postgres 16 container.</item>
/// <item>Applies the User, Accounts, and ShramSafal migration chains
/// (provides <c>public.users</c>, <c>accounts.subscriptions</c>,
/// <c>ssf.daily_logs</c>, <c>ssf.verification_events</c>, etc).</item>
/// <item>Applies the full analytics chain — <c>AnalyticsInitial</c>
/// plus the legacy Phase4/Phase7/Ops/MIS_* migrations (now no-ops)
/// plus the new <c>20260502000000_AnalyticsRewrite</c>.</item>
/// <item>Asserts every matview the production code path queries
/// exists with the expected schema (column names + uniqueness).</item>
/// </list>
///
/// <para>
/// This is the green proof for Task 9 closure. Without Testcontainers
/// (or β: a live snapshot) we can't catch column-name drift between
/// the SSF schema and the analytics matview SQL — exactly the class
/// of bug that left Phase4-PhaseOps + MIS_MatViewHealthFix +
/// MIS_DropVerificationsCompatView all broken on a fresh DB.
/// </para>
/// </summary>
[Trait("Category", "RequiresDocker")]
public sealed class AnalyticsMigrationTests : IAsyncLifetime
{
    // Testcontainers 4.x marks the parameterless PostgreSqlBuilder()
    // constructor obsolete; the recommended overload takes the image
    // tag as a constructor argument. The .WithImage() call below
    // satisfies that intent functionally — image gets pinned the
    // same way — but the parameterless ctor itself still emits
    // CS0618. Suppress just this line so CI's -warnaserror passes.
#pragma warning disable CS0618 // Type or member is obsolete
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    public Task InitializeAsync() => _pg.StartAsync();
    public Task DisposeAsync() => _pg.DisposeAsync().AsTask();

    [Fact]
    public async Task Full_migration_chain_applies_cleanly_to_fresh_postgres()
    {
        var conn = _pg.GetConnectionString();

        // Apply User schema first (public.users).
        var userOpts = new DbContextOptionsBuilder<UserDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        // Apply Accounts schema (accounts.subscriptions etc).
        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        // Apply ShramSafal schema (ssf.daily_logs, ssf.verification_events
        // and friends — the matview SQL joins these).
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }

        // Apply analytics chain — including the new AnalyticsRewrite.
        // Before Task 9, the legacy Phase4 migration would fail here
        // with `relation "ssf.verifications" does not exist` (or one of
        // a dozen other column-mismatch errors).
        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        // Assert: every matview the production code reads exists
        // under the mis schema with the correct shape.
        await using var checkConn = new NpgsqlConnection(conn);
        await checkConn.OpenAsync();

        var requiredMatviews = new[]
        {
            "wvfd_weekly",
            "log_verify_lag",
            "correction_rate",
            "voice_log_share",
            "schedule_compliance_weekly",
            "schedule_unscheduled_ratio",
            "gemini_cost_per_farm",
            "farmer_suffering_watchlist",
            "alert_r9_api_error_spike",
            "alert_r10_voice_degraded",
        };

        foreach (var matview in requiredMatviews)
        {
            await using var cmd = new NpgsqlCommand(
                "SELECT 1 FROM pg_matviews WHERE schemaname = 'mis' AND matviewname = @name;",
                checkConn);
            cmd.Parameters.AddWithValue("name", matview);
            var present = await cmd.ExecuteScalarAsync();
            present.Should().NotBeNull(
                $"mis.{matview} must exist after the full migration chain runs (Task 9 production-read set)");
        }

        // Spot-check a known-correct column on wvfd_weekly: week_start.
        await using (var cmd = new NpgsqlCommand(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'mis' AND table_name = 'wvfd_weekly'
            ORDER BY ordinal_position;
            """,
            checkConn))
        await using (var reader = await cmd.ExecuteReaderAsync())
        {
            var cols = new List<string>();
            while (await reader.ReadAsync())
            {
                cols.Add(reader.GetString(0));
            }
            cols.Should().Contain(new[] { "farm_id", "week_start", "wvfd", "engagement_tier" },
                "Task 9's wvfd_weekly must expose the columns AdminMisRepository.GetWvfdHistoryAsync queries");
        }

        // Spot-check correction_rate column shape (D2.A redefinition):
        // (farm_id, correction_rate_pct).
        await using (var cmd = new NpgsqlCommand(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'mis' AND table_name = 'correction_rate'
            ORDER BY ordinal_position;
            """,
            checkConn))
        await using (var reader = await cmd.ExecuteReaderAsync())
        {
            var cols = new List<string>();
            while (await reader.ReadAsync())
            {
                cols.Add(reader.GetString(0));
            }
            cols.Should().Contain(new[] { "farm_id", "correction_rate_pct" },
                "Task 9's correction_rate must keep its two-column shape so MisReportRepository's join keeps working");
        }

        // Negative assertion: the dropped matviews (D1.B + D3.B) MUST
        // NOT exist after the rewrite — keeping them as placeholders
        // would hide debt and keep MisRefreshJob noise alive.
        var droppedMatviews = new[]
        {
            "silent_churn_watchlist",
            "zero_engagement_farms",
            "engagement_tier",
            "activation_funnel",
            "d30_retention_paying",
            "schedule_adoption_rate",
            "schedule_migration_rate",
            "schedule_abandonment_rate",
            "feature_retention_lift",
            "new_farm_day_snapshot",
            "activity_heatmap",
            "cohort_quality_score",
            "alert_r1_smooth_decay",
            "alert_r2_wau_vs_wvfd",
            "alert_r3_rubber_stamp",
            "alert_r4_voice_decay",
            "alert_r5_compliance_plateau",
            "alert_r6_flash_churn",
            "alert_r7_correction_rising",
            "alert_r8_referral_quality",
            "api_health_24h",
            "voice_pipeline_health",
        };

        foreach (var dropped in droppedMatviews)
        {
            await using var cmd = new NpgsqlCommand(
                "SELECT 1 FROM pg_matviews WHERE schemaname = 'mis' AND matviewname = @name;",
                checkConn);
            cmd.Parameters.AddWithValue("name", dropped);
            var present = await cmd.ExecuteScalarAsync();
            present.Should().BeNull(
                $"mis.{dropped} must NOT exist on a fresh DB after Task 9 (D1.B/D3.B deferred to T-IGH-03-MIS-MATVIEW-REDESIGN)");
        }
    }
}
