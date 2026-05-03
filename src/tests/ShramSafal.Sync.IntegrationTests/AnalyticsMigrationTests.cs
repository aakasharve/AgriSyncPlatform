using System.Collections.Generic;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
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

        // Apply ShramSafal schema in two phases, mirroring
        // AgriSync.Bootstrapper/Program.cs's startup ordering:
        //
        //   Phase A (up to AlterCostEntriesAddJobCardId): creates
        //     ssf.daily_logs, ssf.verification_events, etc. — every
        //     SSF table that downstream matviews join.
        //   ↓ Analytics chain (creates analytics.events).
        //   Phase B (the rest, including AddAdminScopeHealthView): the
        //     late SSF migrations that reference analytics.events,
        //     which only exists after the analytics chain runs.
        //
        // Without this split the SSF AddAdminScopeHealthView migration
        // fails with `relation "analytics.events" does not exist`.
        // The same target string lives in
        // AgriSync.Bootstrapper/Program.cs as ssfPhaseATarget.
        //
        // DWC v2 (2026-05-03): bumped from AlterCostEntriesAddJobCardId to
        // WtlV0Entities because the DWC analytics matviews
        // (20260505000000_DwcV2Matviews) reference ssf.workers which is
        // created by WtlV0Entities. WtlV0Entities does NOT reference
        // analytics.events so it is safe to include in Phase A.
        const string ssfPhaseATarget = "20260504000000_WtlV0Entities";
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn)
            .Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        // Apply analytics chain — including the new AnalyticsRewrite.
        // Before Task 9, the legacy Phase4 migration would fail here
        // with `relation "ssf.verifications" does not exist` (or one
        // of a dozen other column-mismatch errors).
        //
        // The analytics migrations live in `AgriSync.Bootstrapper` (so
        // BuildingBlocks stays provider-neutral) while the
        // `AnalyticsDbContext` lives in BuildingBlocks. Without the
        // explicit `MigrationsAssembly` pointer, EF Core scans the
        // DbContext's own assembly, finds no migrations, and silently
        // applies zero — leaving `analytics.events` uncreated and
        // breaking the SSF Phase B migrations that join it.
        // Mirror production's wiring (`Program.cs` AnalyticsDb registration).
        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        // Apply SSF Phase B — the rest of the SSF chain. AddAdminScopeHealthView
        // and any other late migrations that join analytics.events now
        // succeed because the Analytics chain above created the table.
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
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
            // T-IGH-03-MIS-MATVIEW-REDESIGN Bucket 1 (ADR-0004 α, restored
            // on 2026-05-01 by 20260502010000_AddSubscriptionFarmsAndChurnMatviews).
            "subscription_farms",
            "silent_churn_watchlist",
            "zero_engagement_farms",
            // T-IGH-03-MIS-MATVIEW-REDESIGN Buckets 2/3/4 (2026-05-03):
            // 13 matviews restored by 20260502020000_RestoreBuckets234Matviews.
            // Each one has a documented in-tree consumer:
            //   * engagement_tier / activation_funnel / d30_retention_paying /
            //     schedule_migration_rate / api_health_24h
            //     -> build/metabase/dashboards/founder.json (cards 8,9,3,10,13).
            //   * alert_r1..alert_r8
            //     -> AgriSync.Bootstrapper.Jobs.AlertDispatcherJob.AlertViews.
            "engagement_tier",
            "activation_funnel",
            "d30_retention_paying",
            "schedule_migration_rate",
            "api_health_24h",
            "alert_r1_smooth_decay",
            "alert_r2_wau_vs_wvfd",
            "alert_r3_rubber_stamp",
            "alert_r4_voice_decay",
            "alert_r5_compliance_plateau",
            "alert_r6_flash_churn",
            "alert_r7_correction_rising",
            "alert_r8_referral_quality",
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

        // Spot-check column shape on wvfd_weekly + correction_rate.
        // Matviews are NOT in information_schema.columns (Postgres
        // restricts that view to base tables and views — relkind 'r'
        // and 'v', not 'm'). We use pg_attribute joined with pg_class
        // to get the column list for matviews.
        const string matviewColumnsSql = """
            SELECT a.attname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'mis'
              AND c.relname = @matview
              AND c.relkind = 'm'
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum;
            """;

        async Task<List<string>> ReadMatviewColumns(string matview)
        {
            var cols = new List<string>();
            await using var cmd = new NpgsqlCommand(matviewColumnsSql, checkConn);
            cmd.Parameters.AddWithValue("matview", matview);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                cols.Add(reader.GetString(0));
            }
            return cols;
        }

        var wvfdCols = await ReadMatviewColumns("wvfd_weekly");
        wvfdCols.Should().Contain(new[] { "farm_id", "week_start", "wvfd", "engagement_tier" },
            "Task 9's wvfd_weekly must expose the columns AdminMisRepository.GetWvfdHistoryAsync queries");

        var correctionCols = await ReadMatviewColumns("correction_rate");
        correctionCols.Should().Contain(new[] { "farm_id", "correction_rate_pct" },
            "Task 9's correction_rate must keep its two-column shape so MisReportRepository's join keeps working");

        // Bucket 1 column-shape spot checks (ADR-0004 α). Each consuming
        // matview must expose the contract its repository reads.
        var subscriptionFarmsCols = await ReadMatviewColumns("subscription_farms");
        subscriptionFarmsCols.Should().Contain(
            new[]
            {
                "subscription_id", "owner_account_id", "plan_code", "subscription_status",
                "valid_from_utc", "valid_until_utc", "trial_ends_at_utc",
                "subscription_started_at_utc", "user_id", "farm_id", "farm_name",
                "farm_owner_account_id", "oam_role", "fm_role",
            },
            "Bucket 1's subscription_farms exposes the 4-hop link projection columns its consuming matviews join on");

        var silentChurnCols = await ReadMatviewColumns("silent_churn_watchlist");
        silentChurnCols.Should().Contain(
            new[]
            {
                "subscription_id", "owner_account_id", "farm_id", "farm_name",
                "plan_code", "subscription_status", "subscription_started_at_utc",
                "last_log_at", "days_since_last_log",
            },
            "Bucket 1's silent_churn_watchlist exposes the columns AdminMisRepository.GetSilentChurnAsync queries");

        var zeroEngagementCols = await ReadMatviewColumns("zero_engagement_farms");
        zeroEngagementCols.Should().Contain(
            new[]
            {
                "subscription_id", "owner_account_id", "farm_id", "farm_name",
                "plan_code", "subscription_status", "subscription_started_at_utc",
                "days_since_subscription",
            },
            "Bucket 1's zero_engagement_farms exposes the columns the never-logged-yet dashboard reads");

        // T-IGH-03-MIS-MATVIEW-REDESIGN Buckets 2/3/4 column contracts.
        // Each spot-check matches the SQL the consumer already runs
        // (Metabase founder.json card N, or AlertDispatcherJob's
        // 'SELECT detector, description FROM {view} WHERE breached = true').
        var engagementTierCols = await ReadMatviewColumns("engagement_tier");
        engagementTierCols.Should().Contain(new[] { "week_start", "tier", "farm_count" },
            "Bucket 2 — Metabase founder dashboard card 8 selects (tier, COUNT) and filters by week_start");

        var activationFunnelCols = await ReadMatviewColumns("activation_funnel");
        activationFunnelCols.Should().Contain(new[] { "cohort_week", "step_order", "step_name", "count" },
            "Bucket 2 — Metabase founder dashboard card 9 selects (step_name, count) and orders by step_order, filters by cohort_week");

        var d30RetentionCols = await ReadMatviewColumns("d30_retention_paying");
        d30RetentionCols.Should().Contain(new[] { "cohort_week", "retention_pct" },
            "Bucket 2 — Metabase founder dashboard card 3 selects retention_pct ordered by cohort_week DESC");

        var scheduleMigrationCols = await ReadMatviewColumns("schedule_migration_rate");
        scheduleMigrationCols.Should().Contain(new[] { "week_start" },
            "Bucket 2 — Metabase founder dashboard card 10 filters by week_start (>= start of current month)");

        var apiHealthCols = await ReadMatviewColumns("api_health_24h");
        apiHealthCols.Should().Contain(new[] { "endpoint", "error_count", "farms_affected", "avg_latency_ms", "max_latency_ms" },
            "Bucket 4 — Metabase founder dashboard card 13 selects all five columns directly");

        // Bucket 3 — every R1..R8 alert matview must expose the same
        // four-column shape AlertDispatcherJob already understands
        // (matches R9 + R10): id INT, detector TEXT, description TEXT, breached BOOL.
        foreach (var alertView in new[]
        {
            "alert_r1_smooth_decay",
            "alert_r2_wau_vs_wvfd",
            "alert_r3_rubber_stamp",
            "alert_r4_voice_decay",
            "alert_r5_compliance_plateau",
            "alert_r6_flash_churn",
            "alert_r7_correction_rising",
            "alert_r8_referral_quality",
        })
        {
            var cols = await ReadMatviewColumns(alertView);
            cols.Should().Contain(new[] { "id", "detector", "description", "breached" },
                $"Bucket 3 — {alertView} must match AlertDispatcherJob's 'SELECT detector, description FROM {{view}} WHERE breached = true' contract");
        }

        // Negative assertion: the still-deferred matviews (NO-CONSUMER set)
        // MUST NOT exist on a fresh DB. After Bucket 1 + Buckets 2/3/4
        // restorations on akash_edits (2026-05-01 + 2026-05-03), 7 from
        // the original 22 dropped matviews stay deferred until at least
        // one consumer (Metabase card / scheduled report / admin endpoint
        // / alert rule) lands; tracked in T-IGH-03-MIS-MATVIEW-REDESIGN.
        var droppedMatviews = new[]
        {
            // Bucket 2 NO-CONSUMER subset.
            "schedule_adoption_rate",
            "schedule_abandonment_rate",
            "feature_retention_lift",
            "new_farm_day_snapshot",
            "activity_heatmap",
            "cohort_quality_score",
            // Bucket 4 NO-CONSUMER subset (AdminOpsRepository.GetVoiceTrendAsync
            // queries analytics.events directly; no Metabase card references it).
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
