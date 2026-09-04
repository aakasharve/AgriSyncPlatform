// spec: 2026-08-28-labour-v2-release-1 (task-0b)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// task-0b (spec 2026-08-28-labour-v2-release-1) — <b>a farmer declares "no work today"; it
/// is saved correctly; he opens the app on another device and it comes back as a work
/// day.</b>
///
/// <para><b>The defect.</b> <c>DailyLog.DayOutcome</c> is stamped canonically at
/// <c>CreateDailyLogHandler.cs:461</c>, BEFORE the primary save — durable, never
/// best-effort. But before this change <c>DailyLogDto</c> had no member for it at all, so
/// nothing on <c>/sync/pull</c> could carry it back. A device that never saw the log
/// locally (a second phone, or a reinstall) had no way to learn the farmer's own
/// declaration, and <c>logsReconciler.ts</c>'s <c>toDailyLog</c> filled the gap with a
/// hardcoded <c>dayOutcome: 'WORK_RECORDED'</c> — a fabricated fact, not a read of one.</para>
///
/// <para><b>Proof 1 is the bug, reproduced on the wire.</b> A log pushed with
/// <c>manualDraft.dayOutcome = "NO_WORK_PLANNED"</c> must come back from
/// <c>PullSyncChangesHandler</c> — the exact handler <c>GET /sync/pull</c> calls — carrying
/// <c>DayOutcome == "NO_WORK_PLANNED"</c>, not null and not <c>"WORK_RECORDED"</c>.</para>
///
/// <para><b>Proof 2 is the control, and the sharper of the two.</b> Doctrine P4: "NULL on
/// every ordinary work day ... nothing defaults it to WORK_RECORDED". An ordinary log —
/// no <c>dayOutcome</c> in the manual draft at all, exactly what most voice-confirmed work
/// days send (<c>logSyncMutationService.ts</c> omits the key when the value would be
/// <c>WORK_RECORDED</c>) — must come back with <c>DayOutcome == null</c>. A server that
/// defaulted the missing declaration to <c>"WORK_RECORDED"</c> would pass Proof 1 and still
/// be committing the exact violation this suite exists to catch — this proof is the one
/// that would catch it.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Own scratch database per run, full
/// migration chain, dropped on dispose. A run without Postgres reports SKIPPED, never
/// Passed.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DayOutcomeSurvivesSyncRoundTripRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0b000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0b000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0b000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0b000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0b000000-0000-0000-0000-000000000005");

    private static readonly DateOnly NoWorkDate = new(2026, 8, 20);
    private static readonly DateOnly OrdinaryWorkDate = new(2026, 8, 21);

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

        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_dayoutcome_pull_{Guid.NewGuid():N}";
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

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await GrantNonSsfSchemasToAppRoleAsync(raw);
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw);
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

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

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — THE BUG. A declared no-work day must read back as one, on the
    // same channel a second device (or a reinstall) actually uses: the pull.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_declared_no_work_day_comes_back_from_the_pull_as_NO_WORK_PLANNED()
    {
        SkipIfPostgresUnavailable();
        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("0bbb1111-1111-1111-1111-111111111111");

        var push = await RunSyncPushAsync(
            clientRequestId: "req-no-work-pull",
            dailyLogId: dailyLogId,
            logDate: NoWorkDate,
            manualDraft: new Dictionary<string, object?> { ["dayOutcome"] = "NO_WORK_PLANNED" });

        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        Assert.Single(push.Value!.Results).Status.Should().Be("applied");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === declared no-work day, as it came back over the wire ===");
        output.WriteLine($"[EVIDENCE] DailyLogDto.DayOutcome = {(pulled.DayOutcome is null ? "NULL" : $"'{pulled.DayOutcome}'")} (expect 'NO_WORK_PLANNED')");

        pulled.DayOutcome.Should().Be("NO_WORK_PLANNED",
            "the farmer's own declaration, stamped canonically before the primary save, must survive the exact " +
            "channel a second device or a reinstall reads it through — a device that never saw this log locally " +
            "has ONLY the pull to learn this from");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — THE CONTROL, and the sharper proof. An ordinary day (no
    // declaration at all) must come back NULL, never defaulted to
    // "WORK_RECORDED". Without this proof, a server-side `?? "WORK_RECORDED"`
    // would still pass Proof 1.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task An_ordinary_day_with_no_declaration_comes_back_NULL_never_WORK_RECORDED()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("0bbb2222-2222-2222-2222-222222222222");

        // No `manualDraft` at all — exactly what most voice-confirmed ordinary work
        // days send: `logSyncMutationService.ts:216` omits `dayOutcome` from the
        // draft whenever its value would be `WORK_RECORDED`.
        var push = await RunSyncPushAsync(
            clientRequestId: "req-ordinary-pull",
            dailyLogId: dailyLogId,
            logDate: OrdinaryWorkDate,
            manualDraft: null);

        push.IsSuccess.Should().BeTrue();
        Assert.Single(push.Value!.Results).Status.Should().Be("applied");

        // Confirm storage directly first — this is what Step 3 (DtoMappingExtensions)
        // must read verbatim, not re-derive.
        await using (var read = new NpgsqlConnection(_superuserConn))
        {
            await read.OpenAsync();
            var stored = await ScalarAsync(read,
                "SELECT day_outcome FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId));
            (stored is null or DBNull).Should().BeTrue(
                "an absent declaration stays absent in storage — never defaulted to WORK_RECORDED (P4)");
        }

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === ordinary day, no declaration, as it came back over the wire ===");
        output.WriteLine($"[EVIDENCE] DailyLogDto.DayOutcome = {(pulled.DayOutcome is null ? "NULL" : $"'{pulled.DayOutcome}'")} (expect NULL)");

        pulled.DayOutcome.Should().BeNull(
            "P4 — 'he did not say' and 'he said work happened' are different facts; a server that defaulted the " +
            "missing declaration to WORK_RECORDED would still pass Proof 1 and be committing exactly the " +
            "violation this suite exists to catch");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness — mirrors OwnerLogSurvivesSyncRoundTripRealPostgresTests exactly:
    // /sync/push admin-elevated, /sync/pull user-scoped (ADR 0019).
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        string clientRequestId,
        Guid dailyLogId,
        DateOnly logDate,
        Dictionary<string, object?>? manualDraft)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmId,
            ["plotId"] = PlotId,
            ["cropCycleId"] = CropCycleId,
            ["operatorUserId"] = OwnerUserId,
            ["logDate"] = logDate.ToString("yyyy-MM-dd"),
        };
        if (manualDraft is not null)
        {
            payload["manualDraft"] = manualDraft;
        }

        var command = new PushSyncBatchCommand(
            DeviceId: "device-dayoutcome-pull",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.2.3");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid userId, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // ADR 0019 — GET /sync/pull runs user-scoped, exactly as the endpoint does.
        sp.GetRequiredService<TenantContext>().SetUserScoped(userId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, userId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId,
            "the log the device just pushed must come back down on the next pull").Subject;
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        return await cmd.ExecuteScalarAsync();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Provisioning evidence — a suite that reports Passed! in ~1s having created
    // ZERO databases has happened here before. Print what was actually built.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task WriteProvisioningEvidenceAsync()
    {
        await using var admin = new NpgsqlConnection(_adminConn);
        await admin.OpenAsync();
        var scratchCount = Convert.ToInt64(await ScalarAsync(admin,
            "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'ssf_dayoutcome_pull_%'"));

        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var tables = Convert.ToInt64(await ScalarAsync(scratch,
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ssf'"));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created     = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] live ssf_dayoutcome_pull_* DBs = {scratchCount} (expect >= 1 during this run)");
        output.WriteLine($"[PROVISIONING] ssf tables after migrations  = {tables} (expect many; 0 would mean no chain ran)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        tables.Should().BeGreaterThan(10, "the migration chain must genuinely have been applied");
    }

    /// <summary>
    /// See the identical note on <c>OwnerLogSurvivesSyncRoundTripRealPostgresTests</c> — the
    /// pull path also reads <c>public.users</c> (operator names), so a scratch database built
    /// purely from the migration chain 42501s before any assertion here runs.
    /// </summary>
    private static async Task GrantNonSsfSchemasToAppRoleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'DayOutcome Pull Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>status 3 = <c>MembershipStatus.Active</c>.</summary>
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

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
