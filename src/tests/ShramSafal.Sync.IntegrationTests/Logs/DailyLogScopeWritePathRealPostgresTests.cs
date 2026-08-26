// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// LABOUR PHASE 2 — <b>the write path, over BOTH entry paths.</b>
///
/// <para><b>Why both.</b> The two paths do not share a gate:
/// <c>POST /logs</c> resolves the pipeline-wrapped
/// <c>IHandler&lt;CreateDailyLogCommand, DailyLogDto&gt;</c> (validator →
/// authorizer → handler), while <c>/sync/push</c> deliberately resolves the RAW
/// <c>CreateDailyLogHandler</c> and skips the pipeline entirely. A test that
/// exercises one proves nothing about the other, and the phone reaches the
/// server over <c>/sync/push</c>.</para>
///
/// <para><b>The regression that matters most</b> is not the new capability — it
/// is that ordinary single-plot logging is untouched. A payload with <b>no
/// <c>scope</c> key at all</b> (every client shipped today) must still be
/// accepted and must still commit exactly the Labour V1 row, and a payload
/// naming a plot that does not exist must still fail. Both are asserted below.</para>
///
/// <para><b>The allow-list is asserted in both directions</b> (doctrine
/// <c>F5</c>: the <c>/sync/push</c> payload check is a strict allow-list, and a
/// field missing from it rejects the ENTIRE mutation). A one-directional test
/// would pass if somebody replaced the allow-list with "accept anything".</para>
///
/// <para><b>RLS posture.</b> The handler runs as the non-superuser
/// <c>agrisync_app</c> role so FORCE-RLS genuinely applies, and every [Fact]
/// asserts <c>rolsuper OR rolbypassrls</c> is FALSE first — doctrine
/// <c>E3</c>: a proof as <c>postgres</c> is void. Fresh scratch database per
/// [Fact]; never <c>agrisync_dev_v2</c>, never <c>dotnet ef database update</c>.</para>
///
/// <para><b>Independence note.</b> Accepted/rejected outcomes and committed row
/// shapes come from the approved plan §C1-AMENDED + handoff §1. The specific
/// error CODES come from the P2.2 report's owed-coverage list (§10) — the plan
/// itself names only <c>PlotNotFound</c> (§A2) and the allow-list's whole-mutation
/// rejection (<c>F5</c>). Handler source was not read.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyLogScopeWritePathRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Farm A — the farm the caller genuinely belongs to.
    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid PlotA1 = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");
    private static readonly Guid PlotA2 = Guid.Parse("aaaa1115-1111-1111-1111-111111111111");
    private static readonly Guid CycleA1 = Guid.Parse("aaaa1116-1111-1111-1111-111111111111");

    // Farm B — a DIFFERENT farm, whose plot must never be smuggled into A's log.
    private static readonly Guid FarmB = Guid.Parse("bbbb2221-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountB = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("bbbb2223-2222-2222-2222-222222222222");
    private static readonly Guid PlotB1 = Guid.Parse("bbbb2224-2222-2222-2222-222222222222");

    private static readonly DateOnly LogDate = new(2026, 8, 12);

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_scopewrite_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw, FarmA, OwnerA, OwnerAccountA, "Scope Write-Path Farm A");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmA, OwnerA, OwnerAccountA, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotA1, FarmA, "Plot A1");
            await SeedPlotAsync(raw, PlotA2, FarmA, "Plot A2");
            await SeedCropCycleAsync(raw, CycleA1, FarmA, PlotA1, "Grapes", "Vegetative");

            await SeedFarmAsync(raw, FarmB, OwnerB, OwnerAccountB, "Scope Write-Path Farm B");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmB, OwnerB, OwnerAccountB, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotB1, FarmB, "Plot B1");
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

    // ─────────────────────────────────────────────────────────────────────
    // ACCEPTED — every shape a farmer can actually assert, over /sync/push.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Sync_push_accepts_every_scope_and_commits_exactly_what_the_farmer_said()
    {
        AssertNonSuperuserAppRole();

        var legacyPlotLogId = Guid.NewGuid();
        var explicitPlotLogId = Guid.NewGuid();
        var multiPlotLogId = Guid.NewGuid();
        var farmLogId = Guid.NewGuid();
        var farmWithEmptySetLogId = Guid.NewGuid();

        // A — THE REGRESSION THAT MATTERS MOST: the shape every shipped client
        //     sends today, with no `scope` key anywhere in the payload.
        AssertApplied(await PushAsync("req-legacy-plot", new()
        {
            ["dailyLogId"] = legacyPlotLogId,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA1,
            ["cropCycleId"] = CycleA1,
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "legacy Plot (no scope key at all)");

        AssertApplied(await PushAsync("req-explicit-plot", new()
        {
            ["dailyLogId"] = explicitPlotLogId,
            ["farmId"] = FarmA,
            ["scope"] = "Plot",
            ["plotIds"] = new[] { PlotA1 },
            ["plotId"] = PlotA1,
            ["cropCycleId"] = CycleA1,
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "explicit Plot (scope + plotIds — the allow-list's new names)");

        AssertApplied(await PushAsync("req-multiplot", new()
        {
            ["dailyLogId"] = multiPlotLogId,
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA1, PlotA2 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "MultiPlot {A1,A2}");

        AssertApplied(await PushAsync("req-farm", new()
        {
            ["dailyLogId"] = farmLogId,
            ["farmId"] = FarmA,
            ["scope"] = "Farm",
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "Farm (संपूर्ण शेत — no plot fields at all)");

        AssertApplied(await PushAsync("req-farm-empty-set", new()
        {
            ["dailyLogId"] = farmWithEmptySetLogId,
            ["farmId"] = FarmA,
            ["scope"] = "Farm",
            ["plotIds"] = Array.Empty<Guid>(),
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "Farm (explicit empty plotIds)");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var rows = await ReadScopeRowsAsync(read);

        rows[legacyPlotLogId].Should().Be(new ScopeRow("Plot", [PlotA1], PlotA1, CycleA1),
            "a payload with no scope key MEANS one plot with its crop cycle — the shape it has always had");
        rows[explicitPlotLogId].Should().Be(new ScopeRow("Plot", [PlotA1], PlotA1, CycleA1),
            "saying it explicitly must produce the identical row");
        rows[multiPlotLogId].Should().Be(new ScopeRow("MultiPlot", [PlotA1, PlotA2], null, null),
            "ONE shared engagement stays ONE row carrying the whole selection (founder decision O-2) — never N rows");
        rows[farmLogId].Should().Be(new ScopeRow("Farm", [], null, null),
            "संपूर्ण शेत is an empty set — never a fabricated plot, never 'the first plot'");
        rows[farmWithEmptySetLogId].Should().Be(new ScopeRow("Farm", [], null, null));

        var sentinels = Convert.ToInt64(await ScalarAsync(read, """
            SELECT COUNT(*) FROM ssf.daily_logs
            WHERE plot_id = '00000000-0000-0000-0000-000000000000'
               OR crop_cycle_id = '00000000-0000-0000-0000-000000000000'
               OR '00000000-0000-0000-0000-000000000000' = ANY(plot_ids)
            """));
        sentinels.Should().Be(0, "doctrine P4 — no fabricated value may reach a stored row");

        foreach (var (id, row) in rows)
        {
            output.WriteLine($"[EVIDENCE] {id} scope={row.Scope,-9} plot_ids=[{string.Join(",", row.PlotIds)}] " +
                             $"plot_id={row.PlotId?.ToString() ?? "NULL"} crop_cycle_id={row.CropCycleId?.ToString() ?? "NULL"}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // REJECTED — and nothing committed.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Sync_push_refuses_a_payload_that_asserts_something_the_farmer_did_not()
    {
        AssertNonSuperuserAppRole();

        var missingPlot = Guid.Parse("9999aaaa-0000-0000-0000-00000000dead");

        var plotNotFound = await PushAsync("req-missing-plot", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = missingPlot,
            ["cropCycleId"] = CycleA1,
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(plotNotFound, "ShramSafal.PlotNotFound", "Plot naming a plot that does not exist",
            "single-plot logging must be exactly as strict as it was before Phase 2");

        var foreignSecond = await PushAsync("req-foreign-second", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA1, PlotB1 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(foreignSecond, "ShramSafal.PlotNotFound", "MultiPlot whose SECOND plot belongs to another farm",
            "EVERY plot in the set is resolved and checked — validating only the first would let a caller smuggle " +
            "a foreign farm's plot in behind a legitimate one, and the committed row would assert something never verified");

        var foreignFirst = await PushAsync("req-foreign-first", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotB1, PlotA1 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(foreignFirst, "ShramSafal.PlotNotFound", "MultiPlot whose FIRST plot belongs to another farm",
            "the symmetric case — position must not decide whether tenancy is checked");

        var unknownScope = await PushAsync("req-unknown-scope", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "Wholefarm",
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(unknownScope, "ShramSafal.SyncInvalidPayload", "an unrecognised scope string",
            "reading an unknown scope as Plot would turn the farmer's assertion into a claim about a plot nobody named");

        var farmCarryingAPlot = await PushAsync("req-farm-with-plot", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "Farm",
            ["plotId"] = PlotA1,
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(farmCarryingAPlot, "ShramSafal.InvalidCommand", "Farm carrying a plotId",
            "a self-contradiction must fail loudly, not have half of what the farmer said silently discarded");

        var multiPlotWithOne = await PushAsync("req-multiplot-one", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA1 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(multiPlotWithOne, "ShramSafal.InvalidCommand", "MultiPlot with only ONE plot",
            "cardinality >= 2 is what MultiPlot means");

        var multiPlotRepeated = await PushAsync("req-multiplot-dup", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA1, PlotA1 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(multiPlotRepeated, "ShramSafal.InvalidCommand", "MultiPlot with a repeated plot",
            "{A,A} SATISFIES cardinality >= 2, so the database cannot catch it — if this is ever relaxed, " +
            "a repeated plot becomes storable and nothing anywhere notices");

        var plotWithoutAPlot = await PushAsync("req-plot-no-plot", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["scope"] = "Plot",
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        });
        AssertFailed(plotWithoutAPlot, "ShramSafal.InvalidCommand", "Plot scope with plotId omitted",
            "widening nullability so MultiPlot and Farm could exist must not have loosened the Plot path");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var committed = Convert.ToInt64(await ScalarAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs"));
        committed.Should().Be(0, "a rejected mutation must leave ZERO rows — a half-written log is worse than none");
    }

    /// <summary>
    /// Doctrine <c>F5</c> — the <c>/sync/push</c> payload check is a strict
    /// allow-list, and a field missing from it rejects the ENTIRE mutation.
    /// Asserted in both directions: the two new names are accepted, and an
    /// unlisted name is still refused.
    /// </summary>
    [Fact]
    public async Task The_allow_list_learned_two_names_and_is_still_strict()
    {
        AssertNonSuperuserAppRole();

        var acceptedId = Guid.NewGuid();
        AssertApplied(await PushAsync("req-allowlist-positive", new()
        {
            ["dailyLogId"] = acceptedId,
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA1, PlotA2 },
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
        }), "payload carrying BOTH new allow-listed names");

        var rejected = await PushAsync("req-allowlist-negative", new()
        {
            ["dailyLogId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = PlotA1,
            ["cropCycleId"] = CycleA1,
            ["logDate"] = LogDate.ToString("yyyy-MM-dd"),
            ["bogusField"] = "not in the allow-list",
        });
        AssertFailed(rejected, "ShramSafal.SyncInvalidPayload", "a payload carrying an unlisted key",
            "adding two names must not have turned the allow-list into 'accept anything' — that check is what " +
            "stops a client silently sending a field the server drops on the floor");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        Convert.ToInt64(await ScalarAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs"))
            .Should().Be(1, "exactly the one accepted mutation committed");
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE OTHER ENTRY PATH — the pipeline (validator → authorizer → handler)
    // that POST /logs resolves. A sync-only proof says nothing about it.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_pipeline_wrapped_handler_accepts_a_farm_scoped_command_and_still_rejects_an_empty_plot()
    {
        AssertNonSuperuserAppRole();

        var farmLogId = Guid.NewGuid();
        var accepted = await RunThroughPipelineAsync(new CreateDailyLogCommand(
            FarmId: FarmA,
            PlotId: null,
            CropCycleId: null,
            RequestedByUserId: OwnerA,
            OperatorUserId: OwnerA,
            LogDate: LogDate,
            Location: null,
            DeviceId: "device-pipeline",
            ClientRequestId: "req-pipeline-farm",
            DailyLogId: farmLogId,
            ActorRole: "owner",
            Scope: DailyLogScope.Farm));

        accepted.IsSuccess.Should().BeTrue(
            "the validator was the gate that used to reject संपूर्ण शेत on the HTTP path with InvalidCommand — " +
            $"it must now let it through (error was '{accepted.Error.Code}')");

        var rejected = await RunThroughPipelineAsync(new CreateDailyLogCommand(
            FarmId: FarmA,
            PlotId: Guid.Empty,
            CropCycleId: Guid.Empty,
            RequestedByUserId: OwnerA,
            OperatorUserId: OwnerA,
            LogDate: LogDate,
            Location: null,
            DeviceId: "device-pipeline",
            ClientRequestId: "req-pipeline-empty",
            DailyLogId: Guid.NewGuid(),
            ActorRole: "owner",
            Scope: DailyLogScope.Plot));

        rejected.IsSuccess.Should().BeFalse("Guid.Empty is a fabricated plot, not a missing one");
        rejected.Error.Code.Should().Be("ShramSafal.InvalidCommand",
            "the pre-Phase-2 gate on the plot-scoped path must be exactly as strict as it was");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var rows = await ReadScopeRowsAsync(read);
        rows.Should().ContainKey(farmLogId);
        rows[farmLogId].Should().Be(new ScopeRow("Farm", [], null, null),
            "the row the HTTP path commits must be the same honest shape the sync path commits");

        output.WriteLine($"[EVIDENCE] pipeline Farm create -> success={accepted.IsSuccess}; " +
                         $"pipeline Plot with empty ids -> '{rejected.Error.Code}'");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────

    private async Task<SyncMutationResultDto> PushAsync(string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var handler = sp.GetRequiredService<PushSyncBatchHandler>();
        var command = new PushSyncBatchCommand(
            DeviceId: "device-scope-write",
            AuthenticatedUserId: OwnerA,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.2.3");

        var response = await handler.HandleAsync(command);
        response.IsSuccess.Should().BeTrue("the /sync/push batch call itself must succeed even when a mutation is rejected");
        return Assert.Single(response.Value!.Results);
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<DailyLogDto>> RunThroughPipelineAsync(
        CreateDailyLogCommand command)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var handler = sp.GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>();

        return await RlsIdentityScope.RunAsFarmAsync(
            ctx, FarmA, OwnerAccountA, OwnerA,
            async ct => await handler.HandleAsync(command, ct));
    }

    private void AssertApplied(SyncMutationResultDto result, string label)
    {
        output.WriteLine($"[EVIDENCE] {label}: status='{result.Status}' errorCode='{result.ErrorCode}' message='{result.ErrorMessage}'");
        result.Status.Should().Be("applied", $"{label} is something a farmer can truthfully assert");
    }

    private void AssertFailed(SyncMutationResultDto result, string expectedErrorCode, string label, string because)
    {
        output.WriteLine($"[EVIDENCE] {label}: status='{result.Status}' errorCode='{result.ErrorCode}'");
        result.Status.Should().Be("failed", $"{label} must be refused — {because}");
        result.ErrorCode.Should().Be(expectedErrorCode, because);
    }

    private void AssertNonSuperuserAppRole()
    {
        using var appCheck = new NpgsqlConnection(_appConn);
        appCheck.Open();
        using var cmd = appCheck.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(cmd.ExecuteScalar()).Should().BeFalse(
            "doctrine E3 — the write path must run as a NON-superuser, no-BYPASSRLS role or this proof is vacuous");
    }

    private sealed record ScopeRow(string Scope, Guid[] PlotIds, Guid? PlotId, Guid? CropCycleId)
    {
        public bool Equals(ScopeRow? other)
            => other is not null
               && Scope == other.Scope
               && PlotIds.AsSpan().SequenceEqual(other.PlotIds)
               && PlotId == other.PlotId
               && CropCycleId == other.CropCycleId;

        public override int GetHashCode() => HashCode.Combine(Scope, PlotIds.Length, PlotId, CropCycleId);
    }

    private static async Task<Dictionary<Guid, ScopeRow>> ReadScopeRowsAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", scope, plot_ids, plot_id, crop_cycle_id FROM ssf.daily_logs
            """;

        var rows = new Dictionary<Guid, ScopeRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows[reader.GetGuid(0)] = new ScopeRow(
                reader.GetString(1),
                reader.GetFieldValue<Guid[]>(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetGuid(4));
        }

        return rows;
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

    private static async Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(
        NpgsqlConnection db, Guid id, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        cmd.Parameters.AddWithValue("status", status);
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

    private static async Task SeedCropCycleAsync(
        NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId, string crop, string stage)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @crop, @stage, @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("crop", crop);
        cmd.Parameters.AddWithValue("stage", stage);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, System.Threading.CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, System.Threading.CancellationToken ct = default) => Task.CompletedTask;

        public Task EmitManyAsync(
            IEnumerable<AnalyticsEvent> events, System.Threading.CancellationToken ct = default) => Task.CompletedTask;
    }
}
