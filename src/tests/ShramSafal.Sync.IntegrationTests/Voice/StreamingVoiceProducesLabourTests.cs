// spec: 2026-08-28-labour-v2-release-1 (Task 0 — diagnostic)
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Contracts.Sync.Payloads;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Voice;

/// <summary>
/// Task 0 (spec 2026-08-28-labour-v2-release-1) — DIAGNOSTIC, not a build. Answers one
/// question: does a streamed voice parse carrying labour reach a durable
/// <c>ssf.labour_assignments</c> row, end to end, through the CURRENT production code path?
///
/// <para><b>Why this is not redundant with <see cref="Labour.LabourPhaseOneDurabilityRealPostgresTests"/>.</b>
/// That suite's cases exercise a <c>SourceAiJobId</c> that is either present (voice-confirm
/// legacy-derivation and single-producer cases) or absent alongside a HANDWRITTEN manual entry
/// (the Phase-1-boundary / retry-identity / convergence cases). None of them is framed as, or
/// documents itself as proving, the shape the LIVE STREAMING PATH actually produces since
/// 2026-06-10: <c>AiOrchestrator.ParseVoiceStreamAsync</c> persists NO <c>AiJob</c> row (its own
/// header, around line 621: "no AiJob persistence, no idempotency, no breaker bookkeeping"), so
/// a streamed confirm can only ever carry <c>SourceAiJobId: null</c>. This suite states that
/// exact case as its own subject, independent of the Phase-1-boundary/retry/convergence
/// mechanics those other cases exist to prove.
/// </para>
///
/// <para><b>Why direct handler invocation is representative of the wire path, not a shortcut
/// around it.</b> <c>LabourItem</c> (asserted below) is not a test-only shape — it is the
/// SAME generated record (<c>sync-contract/schemas/payloads-csharp/CreateDailyLogPayload.cs</c>,
/// generated from <c>create_daily_log.zod.ts</c>) that <c>PushSyncBatchHandler</c> deserializes
/// off the wire and passes straight through, unmodified, onto
/// <c>CreateDailyLogCommand.Labour</c> (see the "transport only" comment at
/// <c>PushSyncBatchHandler.cs</c> around line 970). There is no separate DTO-to-command mapping
/// step for labour to lose fidelity in; the type used here IS the wire type.</para>
///
/// <para><b>Native :5433, fail-loud.</b> Same contract as the sibling suite this one is modelled
/// on: <see cref="Trait"/>-tagged <c>RequiresPostgres</c>; an unreachable Postgres THROWS out of
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/> so the [Fact]
/// reports FAILED, never a silent skip. Own scratch database per run, dropped on dispose.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class StreamingVoiceProducesLabourTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("ffff1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountId = Guid.Parse("ffff2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserId = Guid.Parse("ffff3333-3333-3333-3333-333333333333");
    private static readonly Guid PlotId = Guid.Parse("ffff4444-4444-4444-4444-444444444444");
    private static readonly Guid CropCycleId = Guid.Parse("ffff5555-5555-5555-5555-555555555555");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_streaming_labour_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw, FarmId, OwnerUserId, OwnerAccountId, "Streaming Voice Labour Farm");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmId, OwnerUserId, OwnerAccountId, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotId, FarmId, "Plot A");
            await SeedCropCycleAsync(raw, CropCycleId, FarmId, PlotId, "Grapes", "Vegetative");
            // Deliberately NO ai_jobs row is seeded: the whole point of this suite is the
            // shape the live streaming path produces, which has no AiJob to reference.
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
        services.AddShramSafalInfrastructure(config);

        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<ILedgerDerivationService, LedgerDerivationService>();
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();
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

    // ─────────────────────────────────────────────────────────────────────────
    // THE QUESTION. A confirm carrying structured labour and NO SourceAiJobId —
    // exactly what the live LiveCaption streaming path produces, since
    // AiOrchestrator.ParseVoiceStreamAsync persists no AiJob for it — is submitted
    // exactly as logSyncMutationService.ts builds it (count -> WorkerCount,
    // type -> EngagementType, sourceAiJobId omitted/null). Does it reach a
    // durable ssf.labour_assignments row?
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Streamed_confirm_with_structured_labour_and_no_source_ai_job_produces_one_durable_labour_row()
    {
        var logId = Guid.Parse("ffff9999-9999-9999-9999-999999999999");
        var assignmentId = Guid.Parse("ffffaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        const int submittedWorkerCount = 8;

        // The exact shape the streaming client produces: structured labour,
        // SourceAiJobId omitted (null) because ParseVoiceStreamAsync never
        // created an AiJob to reference.
        var labour = new List<LabourItem>
        {
            new(LabourAssignmentId: assignmentId, EngagementType: "hired_daily", WorkerCount: submittedWorkerCount),
        };

        var run = await RunHandlerAsync(
            logId, clientRequestId: "req-streaming-voice", sourceAiJobId: null, labour: labour);

        run.Exception.Should().BeNull("a durability diagnostic must not itself throw for an ordinary confirm");
        run.Result.Should().NotBeNull("the handler must return a verdict");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var labourRowCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", logId));

        output.WriteLine("[EVIDENCE] === Task 0 — streaming voice -> labour durability ===");
        output.WriteLine($"[EVIDENCE] handler result.IsSuccess              = {run.Result?.IsSuccess} (expect True)");
        output.WriteLine($"[EVIDENCE] ssf.labour_assignments rows for log   = {labourRowCount} (expect exactly 1)");

        run.Result!.IsSuccess.Should().BeTrue(
            "the streaming path's structured labour must be accepted exactly as the manual path's is — " +
            "SourceAiJobId is not a gate on Phase-1 labour staging");

        labourRowCount.Should().Be(1,
            "exactly one durable ssf.labour_assignments row must exist for a confirm carrying structured " +
            "labour and no SourceAiJobId — this is the shape the live LiveCaption streaming path actually " +
            "produces, and the question this suite exists to answer");

        var row = await ReadSingleLabourRowAsync(read, logId);
        row.WorkerCount.Should().Be(submittedWorkerCount,
            "the durable row must carry the EXACT worker count the farmer's client submitted — P4 forbids " +
            "a fabricated or silently-substituted number");

        output.WriteLine($"[EVIDENCE] durable row worker_count               = {row.WorkerCount} (expect {submittedWorkerCount})");
        output.WriteLine($"[EVIDENCE] durable row engagement_type             = {row.EngagementType}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real handler invocation under the ambient-transaction (SAVEPOINT) posture,
    // as agrisync_app with the tenant GUCs set. Copied from
    // LabourPhaseOneDurabilityRealPostgresTests.RunHandlerAsync byte-for-byte
    // (minus the derivationOverride hook this suite does not need), per the
    // brief's instruction to follow that file's harness style exactly.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record HandlerOutcome(Result<DailyLogDto>? Result, Exception? Exception);

    private async Task<HandlerOutcome> RunHandlerAsync(
        Guid dailyLogId,
        string clientRequestId,
        Guid? sourceAiJobId,
        IReadOnlyList<LabourItem>? labour)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");

        var handler = new CreateDailyLogHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            sp.GetRequiredService<IIdGenerator>(),
            sp.GetRequiredService<IClock>(),
            sp.GetRequiredService<IEntitlementPolicy>(),
            sp.GetRequiredService<IAnalyticsWriter>(),
            sp.GetRequiredService<IAiJobRepository>(),
            sp.GetRequiredService<ILogger<CreateDailyLogHandler>>(),
            sp.GetRequiredService<ILedgerDerivationService>(),
            sp.GetRequiredService<IDailyRichnessDerivationService>(),
            ctx);

        var command = new CreateDailyLogCommand(
            FarmId: FarmId,
            PlotId: PlotId,
            CropCycleId: CropCycleId,
            RequestedByUserId: OwnerUserId,
            OperatorUserId: OwnerUserId,
            LogDate: new DateOnly(2026, 8, 28),
            Location: null,
            DeviceId: "device-streaming-voice-task0",
            ClientRequestId: clientRequestId,
            DailyLogId: dailyLogId,
            ActorRole: "owner",
            SourceAiJobId: sourceAiJobId,
            ClientAppVersion: "1.2.3",
            Labour: labour);

        try
        {
            var result = await handler.HandleAsync(command);
            await tx.CommitAsync();
            return new HandlerOutcome(result, null);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync();
            return new HandlerOutcome(null, ex);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers — copied from LabourPhaseOneDurabilityRealPostgresTests.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record LabourRow(
        string EngagementType, int? WorkerCount, decimal DurationHours,
        string TimeBasis, int? MaleCount, int? FemaleCount);

    private static async Task<LabourRow> ReadSingleLabourRowAsync(NpgsqlConnection db, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT engagement_type, worker_count, duration_hours, time_basis, male_count, female_count
            FROM ssf.labour_assignments
            WHERE daily_log_id = @id
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);

        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue($"a labour row must exist for daily log {dailyLogId}");

        return new LabourRow(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetInt32(1),
            reader.GetDecimal(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetInt32(4),
            reader.IsDBNull(5) ? null : reader.GetInt32(5));
    }

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
        => Convert.ToInt64(await ScalarAsync(db, sql, args));

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
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
