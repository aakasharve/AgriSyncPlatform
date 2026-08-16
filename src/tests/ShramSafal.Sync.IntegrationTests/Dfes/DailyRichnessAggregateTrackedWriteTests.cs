// spec: dfes-companion-2026-07-11
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence; // TenantContext
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// FIX PROOF (dfes-companion-2026-07-11) — the daily-richness recompute was a SILENT
/// no-op on every log after the first of a day.
///
/// <para><b>The bug.</b> <c>DailyRichnessDerivationService.RecomputeAsync</c> did a
/// read-modify-write: read the day's <see cref="DailyRichnessAggregate"/>, call
/// <c>ApplyDerivation</c> on it, let the handler <c>SaveChangesAsync</c>. But the
/// repository read was <c>.AsNoTracking()</c>, so the entity was DETACHED — EF emitted
/// NO UPDATE, threw NOTHING, logged NOTHING. Only the FIRST log of a day (which takes the
/// <c>AddDailyRichnessAggregateAsync</c> INSERT path) ever wrote the row; every recompute
/// after it was discarded, freezing a real day of work at
/// <c>has_work=false</c> / score 0 / <c>UnaccountedDay</c>. Verified live: a
/// <c>/sync/push create_daily_log</c> returned 200, the derivation ran and read both AI
/// jobs, and the row was byte-for-byte unchanged.</para>
///
/// <para><b>Why this test MUST be real EF, not a fake repository.</b> The entire 1164-test
/// unit suite passed while this bug was live in production. Every in-memory
/// <c>IShramSafalRepository</c> double hands back a MUTABLE object from a list, so a
/// detached entity and a tracked entity are indistinguishable — a fake-repository test
/// cannot express the difference and would only manufacture false confidence. Change
/// tracking is a property of the real <c>DbContext</c>, so only a real DbContext against a
/// real database can prove the UPDATE actually reaches the row.</para>
///
/// <para><b>Three proofs.</b>
/// <list type="number">
/// <item>The TRACKED accessor (<c>GetDailyRichnessAggregateForUpdateAsync</c>) +
/// <c>ApplyDerivation</c> + <c>SaveChangesAsync</c> genuinely changes the row, re-read
/// from a FRESH connection (not the write context's identity map).</item>
/// <item>The NO-TRACKING accessor (<c>GetDailyRichnessAggregateAsync</c>) on the same
/// mutation persists NOTHING — the regression guard. It pins the read/write split so the
/// tempting "just drop .AsNoTracking() from the shared method" refactor (which would
/// regress the read-only <c>GetDayUnderstandingHandler</c> query) fails loudly here.</item>
/// <item>End-to-end: <c>RecomputeAsync</c> over an ALREADY-EXISTING aggregate — the exact
/// second-log-of-the-day path that was silently dropped — actually overwrites the
/// persisted row.</item>
/// </list></para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Follows
/// <c>LedgerDerivationSupersessionRealPostgresTests</c> verbatim (same
/// <c>RequiresPostgres</c> trait, same scratch-database lifecycle, same
/// admin-elevate + manual-GUC write posture that dodges the
/// <c>TenantConnectionInterceptor</c> SET LOCAL rows-affected desync). No Docker. If
/// native Postgres :5433 is unreachable the fixture skips cleanly rather than failing.
/// It creates its OWN scratch database and drops it on dispose — it never touches
/// <c>agrisync_dev</c> data.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyRichnessAggregateTrackedWriteTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    // agrisync_app is created by migration 20260515090000_BootstrapDbRoles. Roles are
    // CLUSTER-global, so on a cluster where it already exists the migration is a no-op
    // and the live password is whatever it was rotated to — hence IntegrationPostgres
    // resolves it from AGRISYNC_TEST_APP_ROLE_PASSWORD, not a constant.
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("dfe50000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("dfe50000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("dfe50000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("dfe50000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("dfe50000-0000-0000-0000-000000000005");

    // One date per test so the three proofs never contend on ux_daily_richness_farm_local_date.
    private static readonly DateOnly TrackedDate = new(2026, 7, 11);
    private static readonly DateOnly NoTrackingDate = new(2026, 7, 12);
    private static readonly DateOnly RecomputeDate = new(2026, 7, 13);

    // The deliberately WRONG "frozen" state the live bug left behind.
    private const string StaleEngineVersion = "stale-v0";

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();

        // A genuinely ABSENT server self-skips; a server that answers and refuses us
        // throws (IntegrationPostgres.ProbeOrSkipReasonAsync) — a misconfigured
        // credential must never masquerade as a clean skip.
        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_dfes_track_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Seed parents as superuser (superuser bypasses RLS).
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw);
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
            await SeedStaleAggregateAsync(raw, TrackedDate);
            await SeedStaleAggregateAsync(raw, NoTrackingDate);
            await SeedStaleAggregateAsync(raw, RecomputeDate);
        }

        // Real Infrastructure DI, connected as agrisync_app so FORCE-RLS genuinely applies.
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (!_skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
        {
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
    }

    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-1.4) — <c>Assert.True(true, _skipReason)</c> here
    /// used to report these proofs as PASSING on any runner without Postgres on :5433, having
    /// exercised nothing. <c>Skip.If</c> (Xunit.SkippableFact) reports the run as Skipped —
    /// visually and in exit-code terms distinct from both Passed and Failed — so a database-less
    /// run can never be read as proof the tracked-write fix behaves.
    /// </summary>
    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — the TRACKED accessor really persists the read-modify-write.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Tracked_accessor_read_modify_write_actually_updates_the_row_in_the_database()
    {
        SkipIfPostgresUnavailable();

        await MutateUnderTenantScopeAsync(TrackedDate, useTrackedAccessor: true);

        var row = await ReadAggregateAsync(TrackedDate);

        row.ScoreEngineVersion.Should().Be(DfesTuning.ScoreEngineVersion,
            "the TRACKED accessor attaches the entity, so ApplyDerivation + SaveChangesAsync must emit a real UPDATE");
        row.HasWork.Should().BeTrue("the recompute flipped has_work true and it must reach the row");
        row.DayClassification.Should().Be(nameof(DayClassification.RichWorkDay));
        row.ShramPointsEarned.Should().Be(9);
        row.ExecutionScore.Should().Be(8);

        output.WriteLine("[EVIDENCE] === tracked read-modify-write (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] score_engine_version = '{row.ScoreEngineVersion}' (expect '{DfesTuning.ScoreEngineVersion}', was '{StaleEngineVersion}')");
        output.WriteLine($"[EVIDENCE] has_work             = {row.HasWork} (expect True, was False)");
        output.WriteLine($"[EVIDENCE] day_classification   = '{row.DayClassification}' (expect 'RichWorkDay', was 'UnaccountedDay')");
        output.WriteLine($"[EVIDENCE] shram_points_earned  = {row.ShramPointsEarned} (expect 9, was 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — REGRESSION GUARD. The no-tracking accessor persists NOTHING.
    // This is the bug, pinned. It also fails if anyone "simplifies" the fix by
    // dropping .AsNoTracking() from the shared read-only method (which would
    // regress GetDayUnderstandingHandler's query).
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task No_tracking_accessor_mutation_is_silently_discarded_so_the_write_path_must_never_use_it()
    {
        SkipIfPostgresUnavailable();

        await MutateUnderTenantScopeAsync(NoTrackingDate, useTrackedAccessor: false);

        var row = await ReadAggregateAsync(NoTrackingDate);

        row.ScoreEngineVersion.Should().Be(StaleEngineVersion,
            "GetDailyRichnessAggregateAsync is .AsNoTracking() — its result is DETACHED, so mutating it emits NO UPDATE and SaveChangesAsync succeeds silently. This is exactly the live bug; it is pinned here so the read/write split is never collapsed.");
        row.HasWork.Should().BeFalse("the detached mutation never reached the database");
        row.DayClassification.Should().Be(nameof(DayClassification.UnaccountedDay));
        row.ShramPointsEarned.Should().Be(0);

        output.WriteLine("[EVIDENCE] === no-tracking mutation is a silent no-op (the bug, pinned) ===");
        output.WriteLine($"[EVIDENCE] score_engine_version = '{row.ScoreEngineVersion}' (unchanged — no UPDATE emitted, no exception raised)");
        output.WriteLine($"[EVIDENCE] has_work             = {row.HasWork} (unchanged)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — END-TO-END. RecomputeAsync over an ALREADY-EXISTING aggregate
    // (the second-log-of-the-day path the bug silently dropped) really writes.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task RecomputeAsync_over_an_existing_aggregate_persists_the_new_derivation()
    {
        SkipIfPostgresUnavailable();

        // A real day of work: one DailyLog carrying a Completed LogTask. The log has NO
        // SourceAiJobId, so RecomputeAsync takes the persisted-work fallback → HasWork.
        await SeedDailyLogWithCompletedTaskAsync(RecomputeDate);

        await using (var scope = _rootProvider!.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var ctx = sp.GetRequiredService<ShramSafalDbContext>();
            var tenant = sp.GetRequiredService<TenantContext>();
            var repo = sp.GetRequiredService<IShramSafalRepository>();
            var derivation = sp.GetRequiredService<IDailyRichnessDerivationService>();

            tenant.ElevateToAdminCrossTenant();
            await using var tx = await ctx.Database.BeginTransactionAsync();
            await SetGucsAsync(ctx);

            // RecomputeAsync does NOT commit — the handler owns SaveChanges, exactly as in prod.
            await derivation.RecomputeAsync(FarmId, RecomputeDate);
            await repo.SaveChangesAsync();
            await tx.CommitAsync();
        }

        var row = await ReadAggregateAsync(RecomputeDate);

        row.ScoreEngineVersion.Should().Be(DfesTuning.ScoreEngineVersion,
            "RecomputeAsync must overwrite the pre-existing aggregate — this is the path that was a silent no-op and froze the farmer's day");
        row.HasWork.Should().BeTrue(
            "a Completed LogTask is real recorded work; the recompute must persist has_work=true over the stale false");
        row.DayClassification.Should().NotBe(nameof(DayClassification.UnaccountedDay),
            "the farmer worked — the day must no longer be classified as 'nothing happened'");

        output.WriteLine("[EVIDENCE] === RecomputeAsync over an existing aggregate (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] score_engine_version = '{row.ScoreEngineVersion}' (expect '{DfesTuning.ScoreEngineVersion}', was '{StaleEngineVersion}')");
        output.WriteLine($"[EVIDENCE] has_work             = {row.HasWork} (expect True, was False)");
        output.WriteLine($"[EVIDENCE] day_classification   = '{row.DayClassification}' (must NOT be 'UnaccountedDay')");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write posture — mirrors the prod GUC-SET path: admin-elevate so
    // TenantConnectionInterceptor no-ops (no SET LOCAL prepend → no EF
    // rows-affected desync, per reference_interceptor_setlocal_desyncs_ef_writes),
    // then set the GUCs manually so the RLS USING/WITH CHECK gates pass.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task MutateUnderTenantScopeAsync(DateOnly localDate, bool useTrackedAccessor)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();
        var repo = sp.GetRequiredService<IShramSafalRepository>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx);

        var aggregate = useTrackedAccessor
            ? await repo.GetDailyRichnessAggregateForUpdateAsync(FarmId, localDate)
            : await repo.GetDailyRichnessAggregateAsync(FarmId, localDate);

        aggregate.Should().NotBeNull("the fixture seeded the row for {0}", localDate);

        // The identical mutation both ways — the ONLY difference is which accessor
        // produced the entity. That isolates change tracking as the sole variable.
        aggregate!.ApplyDerivation(
            execScore: 8, insightScore: 7, learningScore: 6,
            classification: DayClassification.RichWorkDay,
            flags: new ContributingFlags(
                HasWork: true, HasMeaningfulObservation: true, HasLearning: true,
                HasExperimentOutcome: false, HasDisturbance: false, HasDeclaredNoWorkReason: false),
            advancesStreak: true, advancesBar: true, shramPoints: 9,
            rewardReasonsJson: "[\"work\"]", noWorkReasonCode: null,
            scoreEngineVersion: DfesTuning.ScoreEngineVersion,
            componentsJson: "{\"execution\":8}");

        // Must not throw either way — the whole point is that the broken path is SILENT.
        await repo.SaveChangesAsync();
        await tx.CommitAsync();
    }

    private async Task SeedDailyLogWithCompletedTaskAsync(DateOnly localDate)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();
        var repo = sp.GetRequiredService<IShramSafalRepository>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx);

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: new FarmId(FarmId),
            plotId: PlotId,
            cropCycleId: CropCycleId,
            operatorUserId: new UserId(OwnerUserId),
            logDate: localDate,
            idempotencyKey: $"dfes-track-{localDate:yyyyMMdd}",
            location: null,
            createdAtUtc: DateTime.UtcNow);
        log.AddTask(
            taskId: Guid.NewGuid(),
            activityType: "फवारणी",
            notes: null,
            occurredAtUtc: DateTime.UtcNow,
            executionStatus: ExecutionStatus.Completed);

        await repo.AddDailyLogAsync(log);
        await repo.SaveChangesAsync();
        await tx.CommitAsync();
    }

    private static async Task SetGucsAsync(ShramSafalDbContext ctx)
    {
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Re-read from a FRESH raw connection — never the write context's identity
    // map, so a "changed" assertion can only pass if the UPDATE truly landed.
    // ─────────────────────────────────────────────────────────────────────────
    private sealed record AggregateRow(
        string ScoreEngineVersion, bool HasWork, string DayClassification,
        int ShramPointsEarned, int? ExecutionScore);

    private async Task<AggregateRow> ReadAggregateAsync(DateOnly localDate)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT score_engine_version, has_work, day_classification,
                   shram_points_earned, execution_score
            FROM ssf.daily_richness_aggregates
            WHERE farm_id = @farm AND local_date = @d
            """;
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", localDate);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the aggregate row must exist for {0}", localDate);
        return new AggregateRow(
            reader.GetString(0), reader.GetBoolean(1), reader.GetString(2),
            reader.GetInt32(3), reader.IsDBNull(4) ? null : reader.GetInt32(4));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────

    // The exact "frozen" shape the live bug produced: a real day of work stuck at
    // has_work=false / UnaccountedDay / 0 points, stamped by a stale engine version.
    private static async Task SeedStaleAggregateAsync(NpgsqlConnection db, DateOnly localDate)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_richness_aggregates
              ("Id", farm_id, local_date, time_zone, day_classification,
               execution_score, insight_score, learning_score,
               has_work, has_meaningful_observation, has_learning, has_experiment_outcome,
               has_disturbance, has_declared_no_work_reason, advances_streak, advances_bar,
               shram_points_earned, reward_reasons, score_engine_version, components_json,
               created_at_utc, updated_at_utc)
            VALUES (@id, @farm, @d, 'Asia/Kolkata', 'UnaccountedDay',
               0, 0, 0,
               false, false, false, false, false, false, false, false,
               0, '[]'::jsonb, @engine, '{}'::jsonb, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", localDate);
        cmd.Parameters.AddWithValue("engine", StaleEngineVersion);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'DFES Tracked-Write Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, 'PrimaryOwner', NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("user", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, 'Plot A', 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", PlotId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", CropCycleId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("plot", PlotId);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }

}
