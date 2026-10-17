// spec: 2026-08-25-prod-cutover-waves (B002, PR #82 review)
using System;
using System.Collections.Generic;
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
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>B002 — "the labour door saves labour only"</b> (founder ruling 2026-08-31), on the
/// real <c>/sync/push</c> path.
///
/// <para><b>The defect.</b> Once the हजेरी-door confirm carries the voice job's provenance
/// (PR #82), <c>CreateDailyLogHandler</c> derives typed rows from that job's WHOLE parse.
/// "रोकडेचे दहा लोक आले, फवारणी केली, पाणी दिलं" at the attendance door would then write
/// a spray (farm operation + input items), an irrigation (+ routine), machinery, an
/// observation and a disturbance — records the farmer never saw on that screen, never
/// confirmed, and cannot find to correct.</para>
///
/// <para><b>The fix under test.</b> <c>create_daily_log.captureScope = "labour"</c> makes the
/// server derive the labour bucket ONLY, keep the job link and its Voice provenance, and
/// stamp no day outcome. Absent keeps today's whole-parse behaviour (old clients); an
/// unknown value is refused before anything is written.</para>
///
/// <para><b>Native :5433, fail-loud.</b> <c>RequiresPostgres</c>; each fact builds its OWN
/// scratch <c>ssf_capture_scope_*</c> database (full migration chain), drives the
/// PRODUCTION <see cref="PushSyncBatchHandler"/> from <c>AddShramSafalApi</c> as the
/// non-superuser <c>agrisync_app</c> role, and drops the database on dispose.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourDoorCaptureScopeRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0d000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0d000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0d000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0d000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0d000000-0000-0000-0000-000000000005");

    /// <summary>
    /// What ONE utterance at the हजेरी door can parse into: a spray with a two-product
    /// mix, an irrigation, the crew, a machine, an observation and a disturbance.
    /// </summary>
    private const string FullParseJson = """
    {
      "summary": "रोकडेचे दहा लोक आले, फवारणी केली, पाणी दिलं",
      "dayOutcome": "WORK_RECORDED",
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "मॅन्कोझेब फवारणी",
          "method": "Spray",
          "type": "fungicide",
          "mix": [
            { "id": "m0", "productName": "Mancozeb", "dose": 500, "unit": "g" },
            { "id": "m1", "productName": "Sticker", "dose": 100, "unit": "ml" }
          ]
        }
      ],
      "irrigation": [
        { "id": "irr-0", "role": "irrigation", "method": "drip", "source": "borewell", "durationHours": 2 }
      ],
      "labour": [
        { "id": "lab-0", "engagementType": "hired_daily", "count": 10, "rate": 350, "workerNames": ["रमेश", "सीता"] }
      ],
      "machinery": [
        { "id": "mc-0", "type": "sprayer", "ownership": "owned", "implement": "blower" }
      ],
      "observations": [
        { "id": "ob-0", "textRaw": "पानावर डाग दिसले", "noteType": "issue", "severity": "important" }
      ],
      "disturbance": { "scope": "PARTIAL", "reason": "दुपारी पाऊस आला", "cause": "WEATHER" }
    }
    """;

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_capture_scope_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
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
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm, 'Capture Scope Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
    // 1. THE FIX — a labour-scoped confirm writes labour and nothing else.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_labour_scoped_confirm_linking_a_full_parse_writes_only_labour_and_keeps_the_job_link()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        // (a) derived from the job: no structured labour[] on the payload.
        var jobA = await SeedJobAsync("capture-scope-a");
        var derivedLog = Guid.NewGuid();
        await PushAppliedAsync("req-capture-labour-derived", derivedLog, jobA, captureScope: "labour", labour: null);

        // (b) the real हजेरी confirm: structured labour[] (with names) + the job link.
        var jobB = await SeedJobAsync("capture-scope-b");
        var structuredLog = Guid.NewGuid();
        var structuredAssignment = Guid.NewGuid();
        await PushAppliedAsync("req-capture-labour-structured", structuredLog, jobB, captureScope: "labour", labour:
        [
            new Dictionary<string, object?>
            {
                ["labourAssignmentId"] = structuredAssignment,
                ["engagementType"] = "hired_daily",
                ["workerCount"] = 10,
                ["workerNames"] = new[] { "रमेश", "सीता" },
            },
        ]);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        foreach (var (label, logId, jobId) in new[] { ("derived", derivedLog, jobA), ("structured", structuredLog, jobB) })
        {
            var tally = await TallyAsync(read, logId);
            output.WriteLine($"[EVIDENCE] labour-scoped/{label}: {tally}");

            tally.Labour.Should().Be(1, "the crew is the one thing the हजेरी door records");
            tally.FarmOperations.Should().Be(0, "the spray was parsed, never confirmed at this door");
            tally.InputItems.Should().Be(0);
            tally.Irrigation.Should().Be(0);
            tally.Machinery.Should().Be(0);
            tally.Observations.Should().Be(0);
            tally.Disturbances.Should().Be(0);

            var (linkedJob, source, dayOutcome) = await LogHeaderAsync(read, logId);
            linkedJob.Should().Be(jobId, "the job link stays — the parse DID produce this record");
            source.Should().Be("voice", "and its provenance stays honest");
            dayOutcome.Should().BeNull("the हजेरी door offers no day declaration");
        }

        var routines = Convert.ToInt64(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.routine_patterns WHERE farm_id = @farm", ("farm", FarmId)));
        routines.Should().Be(0, "no irrigation was derived, so no routine was seeded from one");

        // The structured row is the canonical one, names and all (P7: count is the farmer's 10).
        var names = Convert.ToString(await ScalarAsync(read,
            "SELECT worker_names_json::text FROM ssf.labour_assignments WHERE \"Id\" = @id",
            ("id", structuredAssignment)));
        JsonSerializer.Deserialize<string[]>(names!).Should().Equal("रमेश", "सीता");

        output.WriteLine($"[EVIDENCE] routine_patterns for farm = {routines} (expect 0)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. THE CONTROLS — old clients unchanged; an unknown door refused.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Without_captureScope_the_whole_parse_still_derives_and_an_unknown_scope_is_refused()
    {
        var job = await SeedJobAsync("capture-scope-control");
        var unscopedLog = Guid.NewGuid();
        await PushAppliedAsync("req-capture-none", unscopedLog, job, captureScope: null, labour: null);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var tally = await TallyAsync(read, unscopedLog);
        output.WriteLine($"[EVIDENCE] unscoped (old client): {tally}");

        tally.FarmOperations.Should().BeGreaterThanOrEqualTo(1, "an old client's confirm derives the whole parse, exactly as before");
        tally.InputItems.Should().Be(2);
        tally.Irrigation.Should().Be(1);
        tally.Labour.Should().Be(1);
        tally.Machinery.Should().Be(1);
        tally.Observations.Should().Be(1);
        tally.Disturbances.Should().Be(1);

        var refusedLog = Guid.NewGuid();
        var refused = await PushAsync("req-capture-unknown", refusedLog, job, captureScope: "everything", labour: null);
        refused.IsSuccess.Should().BeTrue();
        var result = Assert.Single(refused.Value!.Results);
        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        var written = Convert.ToInt64(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", refusedLog)));
        written.Should().Be(0, "an unknown door is refused before anything is written, never widened to the whole parse");

        output.WriteLine($"[EVIDENCE] captureScope='everything' -> {result.Status} {result.ErrorCode}; daily_logs written = {written}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record Tally(
        long FarmOperations, long InputItems, long Irrigation, long Labour,
        long Machinery, long Observations, long Disturbances);

    private static async Task<Tally> TallyAsync(NpgsqlConnection db, Guid logId)
    {
        async Task<long> Count(string sql) => Convert.ToInt64(await ScalarAsync(db, sql, ("log", logId)));

        return new Tally(
            await Count("SELECT COUNT(*) FROM ssf.farm_operations WHERE source_daily_log_id = @log"),
            await Count("""
                SELECT COUNT(*) FROM ssf.application_input_items i
                JOIN ssf.farm_operations o ON o."Id" = i.operation_id
                WHERE o.source_daily_log_id = @log
                """),
            await Count("SELECT COUNT(*) FROM ssf.irrigation_entries WHERE daily_log_id = @log"),
            await Count("SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @log"),
            await Count("SELECT COUNT(*) FROM ssf.machinery_usages WHERE daily_log_id = @log"),
            await Count("SELECT COUNT(*) FROM ssf.observation_events WHERE daily_log_id = @log"),
            await Count("SELECT COUNT(*) FROM ssf.disturbance_events WHERE daily_log_id = @log"));
    }

    private static async Task<(Guid? Job, string? Source, string? DayOutcome)> LogHeaderAsync(NpgsqlConnection db, Guid logId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT source_ai_job_id, source, day_outcome FROM ssf.daily_logs WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the labour-scoped log itself must be committed");
        return (
            reader.IsDBNull(0) ? null : reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    private async Task<Guid> SeedJobAsync(string idempotencyKey)
    {
        var jobId = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, """
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version,
                normalized_result_json)
            VALUES (
                @id, @key, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                '1.0.0', NOW(), 1, NOW(),
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0',
                @json::jsonb);
            INSERT INTO ssf.ai_job_attempts (
                id, ai_job_id, attempt_number, provider, is_success, failure_class,
                latency_ms, attempted_at_utc, source, model_version, prompt_version)
            VALUES (
                @attempt, @id, 1, 'Gemini', true, 'None',
                100, NOW(), 'voice', 'gemini-2.5-flash', 'v3.2.0');
            """,
            ("id", jobId), ("key", idempotencyKey), ("uid", OwnerUserId), ("fid", FarmId),
            ("json", FullParseJson), ("attempt", Guid.NewGuid()));
        return jobId;
    }

    private async Task PushAppliedAsync(
        string clientRequestId, Guid dailyLogId, Guid sourceAiJobId, string? captureScope, object[]? labour)
    {
        var push = await PushAsync(clientRequestId, dailyLogId, sourceAiJobId, captureScope, labour);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "error='{0}: {1}'", result.ErrorCode, result.ErrorMessage);
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        string clientRequestId, Guid dailyLogId, Guid sourceAiJobId, string? captureScope, object[]? labour)
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
            ["sourceAiJobId"] = sourceAiJobId,
        };
        if (labour is not null)
        {
            payload["labour"] = labour;
        }

        if (captureScope is not null)
        {
            payload["captureScope"] = captureScope;
        }

        var command = new PushSyncBatchCommand(
            DeviceId: "device-capture-scope",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.15");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(app, "SELECT current_user"));
        var canBypass = Convert.ToBoolean(await ScalarAsync(app,
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
        var database = Convert.ToString(await ScalarAsync(app, "SELECT current_database()"));

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse();
        database.Should().Be(_scratchDbName);

        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

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
