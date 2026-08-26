// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// LABOUR_PHASE2 P2.3 (landmine L6) — <c>GetExecutedTasksByCropCycleIdAsync</c>
/// against REAL Postgres.
///
/// <para><b>What was broken.</b> The query filtered
/// <c>log.CropCycleId == cropCycleId</c>. A <c>MultiPlot</c> or <c>Farm</c>
/// scoped log carries <c>crop_cycle_id IS NULL</c> by design, so its tasks
/// vanished from all three consumers — <c>EvaluateComplianceHandler</c>,
/// <c>ComputePlannedVsExecutedDeltaHandler</c> and
/// <c>GetAttentionBoardHandler</c>. Every one of them feeds CompareEngine, so
/// the farmer would be told he had failed to do work he had actually done: a
/// fabricated breach (<c>P4</c>) on three surfaces at once.</para>
///
/// <para><b>Why this needs real Postgres.</b> The fix matches a plot-less log
/// through <c>plot_ids</c>, a native <c>uuid[]</c> column reached with
/// <c>EF.Property&lt;List&lt;Guid&gt;&gt;(log, "_plotIds").Contains(...)</c>.
/// Whether that translates to SQL at all is a provider fact, not a C# fact — an
/// in-memory harness would prove nothing about it.</para>
///
/// <para><b>This is a query-correctness proof, not an RLS proof.</b> It connects
/// as the migration superuser deliberately, to isolate the predicate from
/// tenant scoping, and must never be cited as coverage for
/// <c>p_tenant_daily_logs</c>. It creates its own scratch database, applies the
/// full migration chain, and drops it on dispose — <c>agrisync_dev</c> and
/// <c>agrisync_dev_v2</c> are never opened.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ExecutedTasksPlotlessScopeRealPostgresTests : IAsyncLifetime
{
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider? _rootProvider;

    private static readonly Guid FarmId = Guid.NewGuid();
    private static readonly Guid OtherFarmId = Guid.NewGuid();
    private static readonly Guid OwnerUserId = Guid.NewGuid();
    private static readonly Guid PlotA = Guid.NewGuid();
    private static readonly Guid PlotB = Guid.NewGuid();
    private static readonly Guid PlotC = Guid.NewGuid();
    private static readonly Guid OtherPlot = Guid.NewGuid();

    /// <summary>Plot A, opened 2026-06-01, still running.</summary>
    private static readonly Guid CycleA = Guid.NewGuid();

    /// <summary>Plot B, 2026-06-01 → 2026-06-05 (CLOSED — the upper bound).</summary>
    private static readonly Guid CycleB = Guid.NewGuid();

    private static readonly Guid OtherCycle = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_p23_executed_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await SeedAsync();

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    [Fact]
    public async Task A_farm_scoped_log_inside_the_cycle_window_counts_as_executed_work()
    {
        var activities = await ExecutedActivitiesAsync(CycleA);

        activities.Should().Contain("spray-farm",
            "a संपूर्ण शेत log covers every plot on the farm, including this cycle's plot — "
            + "dropping it tells the farmer he skipped work he actually did");
    }

    [Fact]
    public async Task A_multi_plot_log_counts_only_for_the_cycles_on_the_plots_it_names()
    {
        var forCycleA = await ExecutedActivitiesAsync(CycleA);

        forCycleA.Should().Contain("spray-multi-ac", "the MultiPlot set {A,C} names plot A");
        forCycleA.Should().NotContain("spray-multi-bc",
            "the MultiPlot set {B,C} does NOT name plot A — attributing it here would be the "
            + "over-count direction of the same fault");
    }

    [Fact]
    public async Task A_plot_scoped_log_behaves_exactly_as_it_did_before()
    {
        var forCycleA = await ExecutedActivitiesAsync(CycleA);

        forCycleA.Should().Contain("spray-plot-a", "the Labour V1 predicate is untouched");
        forCycleA.Should().NotContain("spray-plot-b", "that log names a different cycle");
    }

    [Fact]
    public async Task A_plot_less_log_from_another_farm_is_never_attributed()
    {
        var forCycleA = await ExecutedActivitiesAsync(CycleA);

        forCycleA.Should().NotContain("spray-other-farm");
    }

    [Fact]
    public async Task A_plot_less_log_outside_the_cycle_window_is_not_attributed_to_it()
    {
        // Before the cycle opened.
        var forCycleA = await ExecutedActivitiesAsync(CycleA);
        forCycleA.Should().NotContain("spray-farm-before",
            "the cycle id is the time bound for a plot-scoped log; the cycle's own dates are "
            + "the only honest equivalent when there is no cycle id");

        // After the cycle closed — CycleB ended 2026-06-05 and the farm log is
        // dated 2026-06-10.
        var forCycleB = await ExecutedActivitiesAsync(CycleB);
        forCycleB.Should().NotContain("spray-farm");
        forCycleB.Should().Contain("spray-farm-inwindow", "2026-06-03 is inside 06-01 → 06-05");
        forCycleB.Should().Contain("spray-plot-b");
    }

    [Fact]
    public async Task An_unknown_cycle_id_returns_nothing_rather_than_every_plot_less_log()
    {
        var activities = await ExecutedActivitiesAsync(Guid.NewGuid());

        activities.Should().BeEmpty(
            "with no cycle there is no farm, no plot and no window to match against — "
            + "guessing one would be exactly the fabrication this audit exists to stop");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task<List<string>> ExecutedActivitiesAsync(Guid cycleId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();

        // TenantConnectionInterceptor refuses a command with no tenant claim.
        // Elevate rather than set a farm claim: the predicate under test is the
        // one that must exclude another farm's log, and scoping the connection
        // to a single farm would let RLS do that job instead and hide a broken
        // predicate. Superuser + admin-cross-tenant makes every seeded row
        // visible, so the ONLY thing filtering rows here is the query itself.
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var repository = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();
        var tasks = await repository.GetExecutedTasksByCropCycleIdAsync(cycleId);
        return tasks.Select(t => t.ActivityType).OrderBy(x => x, StringComparer.Ordinal).ToList();
    }

    private async Task SeedAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await SeedFarmAsync(db, FarmId, "P2.3 Executed-Tasks Farm");
        await SeedFarmAsync(db, OtherFarmId, "P2.3 Other Farm");

        await SeedPlotAsync(db, PlotA, FarmId, "A");
        await SeedPlotAsync(db, PlotB, FarmId, "B");
        await SeedPlotAsync(db, PlotC, FarmId, "C");
        await SeedPlotAsync(db, OtherPlot, OtherFarmId, "Z");

        await SeedCycleAsync(db, CycleA, FarmId, PlotA, new DateOnly(2026, 6, 1), null);
        await SeedCycleAsync(db, CycleB, FarmId, PlotB, new DateOnly(2026, 6, 1), new DateOnly(2026, 6, 5));
        await SeedCycleAsync(db, OtherCycle, OtherFarmId, OtherPlot, new DateOnly(2026, 6, 1), null);

        // Plot-scoped: names its cycle. The V1 shape.
        await SeedPlotLogAsync(db, FarmId, PlotA, CycleA, new DateOnly(2026, 6, 10), "spray-plot-a");
        await SeedPlotLogAsync(db, FarmId, PlotB, CycleB, new DateOnly(2026, 6, 2), "spray-plot-b");

        // Farm-scoped: no plot, no cycle.
        await SeedPlotlessLogAsync(db, FarmId, "Farm", [], new DateOnly(2026, 6, 10), "spray-farm");
        await SeedPlotlessLogAsync(db, FarmId, "Farm", [], new DateOnly(2026, 6, 3), "spray-farm-inwindow");
        await SeedPlotlessLogAsync(db, FarmId, "Farm", [], new DateOnly(2026, 5, 1), "spray-farm-before");
        await SeedPlotlessLogAsync(db, OtherFarmId, "Farm", [], new DateOnly(2026, 6, 10), "spray-other-farm");

        // Multi-plot: no single plot, no cycle, but a NAMED set.
        await SeedPlotlessLogAsync(db, FarmId, "MultiPlot", [PlotA, PlotC], new DateOnly(2026, 6, 10), "spray-multi-ac");
        await SeedPlotlessLogAsync(db, FarmId, "MultiPlot", [PlotB, PlotC], new DateOnly(2026, 6, 10), "spray-multi-bc");
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("uid", OwnerUserId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", plotId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("name", name);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCycleAsync(
        NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId, DateOnly start, DateOnly? end)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, end_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, @end, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("start", start);
        cmd.Parameters.AddWithValue("end", (object?)end ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotLogAsync(
        NpgsqlConnection db, Guid farmId, Guid plotId, Guid cycleId, DateOnly logDate, string activityType)
    {
        var logId = Guid.NewGuid();
        await using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @uid, @date, NOW(), 'voice', 'unknown', 'unknown');
                """;
            cmd.Parameters.AddWithValue("id", logId);
            cmd.Parameters.AddWithValue("farm", farmId);
            cmd.Parameters.AddWithValue("plot", plotId);
            cmd.Parameters.AddWithValue("cycle", cycleId);
            cmd.Parameters.AddWithValue("uid", OwnerUserId);
            cmd.Parameters.AddWithValue("date", logDate);
            await cmd.ExecuteNonQueryAsync();
        }

        await SeedTaskAsync(db, logId, activityType);
    }

    private static async Task SeedPlotlessLogAsync(
        NpgsqlConnection db, Guid farmId, string scope, Guid[] plotIds, DateOnly logDate, string activityType)
    {
        var logId = Guid.NewGuid();
        await using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @farm, NULL, NULL, @plots, @scope, @uid, @date, NOW(), 'voice', 'unknown', 'unknown');
                """;
            cmd.Parameters.AddWithValue("id", logId);
            cmd.Parameters.AddWithValue("farm", farmId);
            cmd.Parameters.AddWithValue("plots", plotIds);
            cmd.Parameters.AddWithValue("scope", scope);
            cmd.Parameters.AddWithValue("uid", OwnerUserId);
            cmd.Parameters.AddWithValue("date", logDate);
            await cmd.ExecuteNonQueryAsync();
        }

        await SeedTaskAsync(db, logId, activityType);
    }

    private static async Task SeedTaskAsync(NpgsqlConnection db, Guid logId, string activityType)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, notes, deviation_note, occurred_at_utc, execution_status, compliance_outcome)
            VALUES (@id, @lid, @activity, NULL, NULL, NOW(), 0, 0);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("lid", logId);
        cmd.Parameters.AddWithValue("activity", activityType);
        await cmd.ExecuteNonQueryAsync();
    }
}
