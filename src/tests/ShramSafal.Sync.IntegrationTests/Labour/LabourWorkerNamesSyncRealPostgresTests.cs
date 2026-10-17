// spec: 2026-08-25-prod-cutover-waves
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
using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>"बरोबर doesn't save the name"</b> — the names a farmer gives for a crew must be
/// stored on the server and come back on the pull.
///
/// <para><b>The defect.</b> <c>ssf.labour_assignments.worker_names_json</c> has existed
/// since <c>20260718132540</c> and the voice derivation fills it, but the
/// <c>create_daily_log</c> labour item had no <c>workerNames</c> member, so the
/// manual/attendance path stored <c>[]</c>. The client's 7-day name rule hides a log's
/// names once nothing is unsent and no fresh download vouches for them, and the pull
/// that acknowledged the log vouched for <c>[]</c>: the names were gone after one sync.</para>
///
/// <para><b>What only real Postgres proves here.</b> That the names reach the jsonb
/// column through the PRODUCTION <see cref="PushSyncBatchHandler"/> (resolved from
/// <c>AddShramSafalApi</c>) as the non-superuser <c>agrisync_app</c> role under FORCE-RLS,
/// and come back through the PRODUCTION <see cref="PullSyncChangesHandler"/> — the exact
/// handlers <c>/sync/push</c> and <c>/sync/pull</c> call. The wire shape over HTTP is
/// proven separately in <c>LabourReadBackPullTests</c>.</para>
///
/// <para><b>P7 in the database.</b> <c>worker_count</c> is asserted on the stored row
/// beside the names: names never change it and never invent it.</para>
///
/// <para><b>Native :5433, fail-loud.</b> Tagged <c>RequiresPostgres</c>; every fact creates
/// its OWN scratch <c>ssf_worker_names_*</c> database from the maintenance connection,
/// applies the full migration chain and drops it on dispose. It never reads or writes
/// any developer or production database. If Postgres is unreachable
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/> throws,
/// so a fact reports FAILED, never a silent pass.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourWorkerNamesSyncRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0c000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0c000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0c000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0c000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0c000000-0000-0000-0000-000000000005");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_worker_names_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
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
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm, 'Worker Names Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (@membership, @farm, @owner, 'PrimaryOwner', NOW(), NOW(), @account, 3);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farm, 'Plot A', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farm", FarmId), ("owner", OwnerUserId), ("account", OwnerAccountId),
                ("membership", Guid.NewGuid()), ("plot", PlotId), ("cycle", CropCycleId));
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

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. THE ROUND TRIP — push with names -> stored -> pull returns the same names.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Names_pushed_on_create_daily_log_are_stored_and_come_back_on_the_pull_without_touching_the_count()
    {
        await AssertSuiteRunsAsNonSuperuserOnItsOwnScratchDatabaseAsync();

        var dailyLogId = Guid.NewGuid();
        var named = Guid.NewGuid();        // 8 workers, 2 of them named (+ a blank)
        var outnumbered = Guid.NewGuid();  // 1 worker stated, 3 names
        var countless = Guid.NewGuid();    // no count stated, 1 name
        var oldClient = Guid.NewGuid();    // no workerNames key at all

        var push = await RunSyncPushAsync("req-names-round-trip", dailyLogId, new object[]
        {
            LabourItem(named, workerCount: 8, workerNames: new[] { " रमेश ", "सीता", "   " }),
            LabourItem(outnumbered, workerCount: 1, workerNames: new[] { "गणेश", "सुनीता", "बाळू" }),
            LabourItem(countless, workerCount: null, workerNames: new[] { "बाळू" }),
            LabourItem(oldClient, workerCount: 4, workerNames: null),
        });

        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "error='{0}: {1}'", result.ErrorCode, result.ErrorMessage);

        // ── Stored, read back as the superuser straight off the rows ──────────
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var stored = new Dictionary<Guid, (string[] Names, int? Count)>();
        await using (var cmd = read.CreateCommand())
        {
            cmd.CommandText = """
                SELECT "Id", worker_names_json::text, worker_count
                FROM ssf.labour_assignments WHERE daily_log_id = @log
                """;
            cmd.Parameters.AddWithValue("log", dailyLogId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                stored[reader.GetGuid(0)] = (
                    JsonSerializer.Deserialize<string[]>(reader.GetString(1))!,
                    reader.IsDBNull(2) ? null : reader.GetInt32(2));
            }
        }

        stored.Should().HaveCount(4);
        stored[named].Names.Should().Equal(["रमेश", "सीता"], "trimmed, blank shed (B002), in the farmer's order");
        stored[named].Count.Should().Be(8, "P7 — two names beside eight workers is still eight");
        stored[outnumbered].Names.Should().Equal(["गणेश", "सुनीता", "बाळू"]);
        stored[outnumbered].Count.Should().Be(1, "P7 — more names than the stated count never raise the count");
        stored[countless].Names.Should().Equal(["बाळू"]);
        stored[countless].Count.Should().BeNull("P7 — a name is not a headcount; silence stays NULL, never 1");
        stored[oldClient].Names.Should().BeEmpty("a client that sends no names stores exactly what it stored before");
        stored[oldClient].Count.Should().Be(4);

        // ── The pull: the exact handler GET /sync/pull calls, user-scoped ─────
        var pulled = await PullDailyLogAsync(dailyLogId);
        var byId = pulled.Labour!.ToDictionary(e => e.LabourAssignmentId);

        byId[named].WorkerNames.Should().Equal(stored[named].Names);
        byId[named].WorkerCount.Should().Be(8);
        byId[outnumbered].WorkerNames.Should().Equal(stored[outnumbered].Names);
        byId[outnumbered].WorkerCount.Should().Be(1);
        byId[countless].WorkerNames.Should().Equal(stored[countless].Names);
        byId[countless].WorkerCount.Should().BeNull();
        byId[oldClient].WorkerNames.Should().BeEmpty();

        output.WriteLine("[EVIDENCE] === worker names round trip (real Npgsql :5433, agrisync_app) ===");
        foreach (var (label, id) in new[] { ("named", named), ("outnumbered", outnumbered), ("countless", countless), ("old client", oldClient) })
        {
            output.WriteLine(
                $"[EVIDENCE] {label,-12} stored=[{string.Join(", ", stored[id].Names)}] count={stored[id].Count?.ToString() ?? "NULL"} " +
                $"| pulled=[{string.Join(", ", byId[id].WorkerNames)}] count={byId[id].WorkerCount?.ToString() ?? "NULL"}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. THE BOUND — refused whole and loudly, nothing written.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_over_bound_name_list_is_refused_whole_and_writes_neither_the_log_nor_its_labour()
    {
        var dailyLogId = Guid.NewGuid();
        var tooMany = Enumerable.Range(0, LabourAssignmentFactory.MaxWorkerNamesPerEngagement + 1)
            .Select(i => $"n{i}").ToArray();

        var push = await RunSyncPushAsync("req-names-over-bound", dailyLogId, new object[]
        {
            LabourItem(Guid.NewGuid(), workerCount: 8, workerNames: tooMany),
        });

        push.IsSuccess.Should().BeTrue("the batch itself succeeds; the one mutation is refused");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var logs = Convert.ToInt64(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId)));
        var labour = Convert.ToInt64(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", dailyLogId)));

        logs.Should().Be(0, "a refused list is refused WHOLE — never silently trimmed into a partial record");
        labour.Should().Be(0);

        output.WriteLine("[EVIDENCE] === over-bound worker names ===");
        output.WriteLine($"[EVIDENCE] names sent = {tooMany.Length}; status = {result.Status}; code = {result.ErrorCode}");
        output.WriteLine($"[EVIDENCE] daily_logs = {logs}, labour_assignments = {labour} (expect 0, 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness — /sync/push admin-elevated, /sync/pull user-scoped (ADR 0019),
    // exactly as DayOutcomeSurvivesSyncRoundTripRealPostgresTests drives them.
    // ─────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> LabourItem(Guid id, int? workerCount, string[]? workerNames)
    {
        var item = new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = id,
            ["engagementType"] = "hired_daily",
            ["workerCount"] = workerCount,
            ["task"] = "छाटणी",
        };
        if (workerNames is not null)
        {
            item["workerNames"] = workerNames;
        }

        return item;
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        string clientRequestId, Guid dailyLogId, object[] labour)
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
            ["logDate"] = "2026-10-16",
            ["labour"] = labour,
        };

        var command = new PushSyncBatchCommand(
            DeviceId: "device-worker-names",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.15");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(OwnerUserId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, OwnerUserId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId).Subject;
    }

    private async Task AssertSuiteRunsAsNonSuperuserOnItsOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(app, "SELECT current_user"));
        var canBypass = Convert.ToBoolean(await ScalarAsync(app,
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
        var database = Convert.ToString(await ScalarAsync(app, "SELECT current_database()"));

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse("FORCE-RLS must genuinely apply to every write and read in this suite");
        database.Should().Be(_scratchDbName, "the suite must run against its OWN scratch database");

        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    /// <summary>
    /// The pull path also reads <c>public.users</c> (operator names), so a scratch database
    /// built purely from the migration chain needs these grants — same note as
    /// <c>OwnerLogSurvivesSyncRoundTripRealPostgresTests</c>.
    /// </summary>
    private static Task GrantNonSsfSchemasToAppRoleAsync(NpgsqlConnection db)
        => ExecAsync(db, $"""
            GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
            """);

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<object?> ScalarAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
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
