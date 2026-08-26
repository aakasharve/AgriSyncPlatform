// spec: ai-intelligence-plan-2026-06-25
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
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

namespace ShramSafal.Sync.IntegrationTests;

/// <summary>
/// Fix 1 (ai-intelligence-plan-2026-06-25) — the machine-gate proof that the
/// typed-ledger derivation actually POPULATES on the production
/// <c>POST /sync/push</c> code path, against REAL Npgsql on native Postgres
/// :5433, connected as the non-superuser <c>agrisync_app</c> role so FORCE-RLS
/// genuinely applies.
///
/// <para><b>Why this test and not <see cref="SyncEndpointsTests"/>.</b> Every
/// existing sync-push integration test drives an EF <c>UseInMemoryDatabase</c>
/// harness (RLS-free), so the tenant WITH CHECK on <c>ssf.farm_operations</c>
/// never fires there — which is exactly why the dormant-ledger gap was
/// invisible. This test drives the ACTUAL <see cref="PushSyncBatchHandler"/>
/// (resolved from the production <c>AddShramSafalApi</c> DI graph) against a real
/// Postgres RLS surface. Critically it does NOT <c>set_config</c> the farm GUC
/// itself — it only admin-elevates <see cref="TenantContext"/> exactly as the
/// <c>/sync/push</c> skip-list in <c>TenantTransactionMiddleware</c> does, then
/// lets the handler run. So it faithfully reproduces the live posture where the
/// handler is solely responsible for establishing the farm GUC.</para>
///
/// <para><b>Two proofs.</b>
/// <list type="number">
/// <item>A <c>create_daily_log</c> for Farm A carrying a SAME-FARM
/// <c>sourceAiJobId</c> → the daily_log persists AND
/// <c>ssf.farm_operations</c> (+ <c>ssf.application_input_items</c>) for Farm A
/// get rows. WITHOUT Fix 1 the parent tenant WITH CHECK rejects the
/// farm_operations insert (42501) — the non-blocking side-car swallows it and
/// the ledger stays empty. This is the regression guard.</item>
/// <item>A <c>create_daily_log</c> for Farm B carrying Farm A's
/// <c>sourceAiJobId</c> (cross-farm) → the log commits but derives NOTHING for B
/// and leaves A's ledger untouched. This is the F1 application-layer isolation
/// gate (<c>CreateDailyLogHandler</c>: a job whose FarmId != command.FarmId is
/// treated as absent → Manual, no derivation).</item>
/// </list></para>
///
/// <para><b>Native :5433, fail-loud (2026-07-19).</b> Tagged
/// <c>[Trait("Category","RequiresPostgres")]</c>; creates its OWN scratch DB,
/// applies the full migration chain, drops it on dispose. If native Postgres
/// is unreachable, <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact]s report FAILED,
/// never a silent skip. This suite proves a real tenant-security /
/// money-adjacent invariant and must never pass without having run.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class SyncPushLedgerDerivationRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    // agrisync_app is created by migration 20260515090000_BootstrapDbRoles with
    // this literal local-dev password; roles are cluster-global so it already
    // exists on the :5433 cluster.
    private const string AppRoleUser = "agrisync_app";
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Farm A — the same-farm derivation case.
    private static readonly Guid FarmA = Guid.Parse("dddd1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("dddd1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerUserA = Guid.Parse("dddd1113-1111-1111-1111-111111111111");
    private static readonly Guid PlotA = Guid.Parse("dddd1114-1111-1111-1111-111111111111");
    private static readonly Guid CropCycleA = Guid.Parse("dddd1115-1111-1111-1111-111111111111");
    private static readonly Guid AiJobA = Guid.Parse("dddd1116-1111-1111-1111-111111111111");
    private static readonly Guid AttemptA = Guid.Parse("dddd1117-1111-1111-1111-111111111111");

    // Farm B — the cross-farm isolation case.
    private static readonly Guid FarmB = Guid.Parse("dddd2221-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountB = Guid.Parse("dddd2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerUserB = Guid.Parse("dddd2223-2222-2222-2222-222222222222");
    private static readonly Guid PlotB = Guid.Parse("dddd2224-2222-2222-2222-222222222222");
    private static readonly Guid CropCycleB = Guid.Parse("dddd2225-2222-2222-2222-222222222222");

    // Rich voice blob exercising the inputs family so the derivation yields
    // farm_operations (+ 2 application_input_items via the mix) alongside the
    // daily_logs-children families. Mirrors the fixture shape proven by
    // LedgerDerivationSupersessionRealPostgresTests.
    private const string VoiceJson = """
    {
      "summary": "फर्टिगेशन",
      "dayOutcome": "WORK_RECORDED",
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 fertigation four kg",
          "type": "fertilizer",
          "mix": [
            { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" },
            { "id": "m1", "productName": "Calcium Nitrate", "dose": 2, "unit": "kg" }
          ]
        }
      ],
      "irrigation": [
        { "id": "irr-0", "role": "fertigation", "method": "drip", "source": "borewell", "durationHours": 2.5 }
      ],
      "labour": [
        { "id": "lab-0", "engagementType": "hired_daily", "maleCount": 2, "femaleCount": 3, "rate": 350 }
      ]
    }
    """;

    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _appConn = string.Empty;
    private string _adminConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        // Throws (does not skip) if Postgres is unconfigured/unreachable — see
        // RequiresPostgresConnection's doc comment for the 2026-07-19
        // CI-truthfulness fix this enforces.
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_fix1_proof_{Guid.NewGuid():N}";
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
        _adminConn = baseConn;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Seed both farms as superuser (superuser bypasses RLS).
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            await SeedFarmAsync(raw, FarmA, OwnerUserA, OwnerAccountA, "Fix1 Farm A");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmA, OwnerUserA, OwnerAccountA, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
            await SeedCropCycleAsync(raw, CropCycleA, FarmA, PlotA, "Grapes", "Vegetative");
            await SeedAiJobAsync(raw, AiJobA, FarmA, OwnerUserA, "fix1-voice-key-A", VoiceJson);
            await SeedAiJobAttemptAsync(raw, AttemptA, AiJobA);

            await SeedFarmAsync(raw, FarmB, OwnerUserB, OwnerAccountB, "Fix1 Farm B");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmB, OwnerUserB, OwnerAccountB, "PrimaryOwner", status: 3);
            await SeedPlotAsync(raw, PlotB, FarmB, "Plot B");
            await SeedCropCycleAsync(raw, CropCycleB, FarmB, PlotB, "Sugarcane", "Vegetative");
        }

        // Production DI graph (AddShramSafalApi → AddShramSafalInfrastructure)
        // connected as agrisync_app so FORCE-RLS is real. This registers the REAL
        // PushSyncBatchHandler + every collaborator + ISyncMutationStore + the
        // TenantConnectionInterceptor exactly as production does.
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

        // Collaborators the Api DI leaves for the Bootstrapper/BuildingBlocks in
        // production (deterministic id generator + clock), plus test doubles for
        // the two collaborators orthogonal to this proof (entitlement gate +
        // analytics sink). Registered AFTER AddShramSafalApi so last-in wins.
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

        if (!string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
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

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — same-farm sourceAiJobId derives the typed ledger on /sync/push.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task SyncPush_create_daily_log_with_same_farm_source_job_populates_farm_operations_and_input_items()
    {
        var dailyLogId = Guid.Parse("eeee1111-1111-1111-1111-111111111111");

        var response = await RunSyncPushCreateDailyLogAsync(
            actorUserId: OwnerUserA,
            actorRole: "owner",
            deviceId: "device-fix1-A",
            clientRequestId: "req-fix1-A",
            dailyLogId: dailyLogId,
            farmId: FarmA,
            plotId: PlotA,
            cropCycleId: CropCycleA,
            operatorUserId: OwnerUserA,
            sourceAiJobId: AiJobA);

        response.IsSuccess.Should().BeTrue("the /sync/push batch call must succeed");
        var mutationResult = Assert.Single(response.Value!.Results);
        output.WriteLine(
            $"[EVIDENCE] mutation status='{mutationResult.Status}' errorCode='{mutationResult.ErrorCode}' errorMessage='{mutationResult.ErrorMessage}'");
        mutationResult.Status.Should().Be("applied",
            "the create_daily_log mutation must be applied, not failed/duplicate");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        // Anchor: the handler write path ran as a NON-superuser, no-BYPASSRLS
        // role so FORCE-RLS genuinely applied — this is not a superuser-vacuous
        // pass.
        await using (var appCheck = new NpgsqlConnection(_appConn))
        {
            await appCheck.OpenAsync();
            var isSuper = Convert.ToBoolean(await ScalarAsync(appCheck,
                "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
            var role = Convert.ToString(await ScalarAsync(appCheck, "SELECT current_user"));
            isSuper.Should().BeFalse(
                "the app connection must be a NON-superuser, no-BYPASSRLS role so FORCE-RLS is real");
            output.WriteLine($"[EVIDENCE] /sync/push handler ran as role='{role}', superuser_or_bypassrls={isSuper}");
        }

        // The daily_log persists.
        var logCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId));
        logCount.Should().Be(1, "the daily_log must be durable on /sync/push");

        // The typed ledger populated for Farm A (the Fix 1 target).
        var farmOps = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm AND is_current_version",
            ("farm", FarmA));
        farmOps.Should().BeGreaterThanOrEqualTo(1,
            "Fix 1 — the /sync/push derivation must insert the parent farm_operation (blocked by the tenant WITH CHECK when the farm GUC is unset)");

        var inputItems = await ScalarLongAsync(read, """
            SELECT COUNT(*)
            FROM ssf.application_input_items i
            JOIN ssf.farm_operations o ON o."Id" = i.operation_id
            WHERE o.farm_id = @farm AND o.is_current_version
            """, ("farm", FarmA));
        inputItems.Should().BeGreaterThanOrEqualTo(1,
            "Fix 1 — application_input_items must hang off the derived current farm_operation");

        output.WriteLine("[EVIDENCE] === Fix 1 /sync/push derivation proof (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] daily_logs (Farm A)            = {logCount} (expect 1)");
        output.WriteLine($"[EVIDENCE] current farm_operations (A)    = {farmOps} (expect >= 1)");
        output.WriteLine($"[EVIDENCE] application_input_items (A)    = {inputItems} (expect >= 1)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — cross-farm sourceAiJobId derives nothing (F1 isolation gate).
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task SyncPush_create_daily_log_with_cross_farm_source_job_derives_nothing_and_leaves_other_farm_untouched()
    {
        var dailyLogId = Guid.Parse("eeee2222-2222-2222-2222-222222222222");

        // Farm B's owner submits a create_daily_log carrying Farm A's AiJob id.
        var response = await RunSyncPushCreateDailyLogAsync(
            actorUserId: OwnerUserB,
            actorRole: "owner",
            deviceId: "device-fix1-B",
            clientRequestId: "req-fix1-B",
            dailyLogId: dailyLogId,
            farmId: FarmB,
            plotId: PlotB,
            cropCycleId: CropCycleB,
            operatorUserId: OwnerUserB,
            sourceAiJobId: AiJobA); // cross-farm

        response.IsSuccess.Should().BeTrue("the /sync/push batch call must succeed");
        var mutationResult = Assert.Single(response.Value!.Results);
        output.WriteLine(
            $"[EVIDENCE] mutation status='{mutationResult.Status}' errorCode='{mutationResult.ErrorCode}' errorMessage='{mutationResult.ErrorMessage}'");
        mutationResult.Status.Should().Be("applied",
            "the log itself commits with Manual provenance — the cross-farm job is treated as absent, not an error");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var logCount = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId));
        logCount.Should().Be(1, "the Farm B log must still commit");

        var farmOpsB = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm",
            ("farm", FarmB));
        farmOpsB.Should().Be(0,
            "F1 isolation — a cross-farm source job must derive NOTHING for Farm B");

        var farmOpsA = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE farm_id = @farm",
            ("farm", FarmA));
        farmOpsA.Should().Be(0,
            "F1 isolation — Farm A's ledger must be untouched by Farm B's cross-farm submission (no cross-tenant leak)");

        output.WriteLine("[EVIDENCE] === Fix 1 cross-farm isolation proof (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] daily_logs (Farm B)            = {logCount} (expect 1)");
        output.WriteLine($"[EVIDENCE] farm_operations (Farm B)       = {farmOpsB} (expect 0)");
        output.WriteLine($"[EVIDENCE] farm_operations (Farm A)       = {farmOpsA} (expect 0 — untouched)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Drives the ACTUAL PushSyncBatchHandler under the production /sync/push
    // posture: admin-elevate TenantContext (exactly what the /sync/push skip-list
    // in TenantTransactionMiddleware does) and then invoke the handler. The test
    // sets NO farm GUC — the handler is solely responsible for it. The handler
    // opens its own per-mutation transaction internally.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>>
        RunSyncPushCreateDailyLogAsync(
            Guid actorUserId,
            string actorRole,
            string deviceId,
            string clientRequestId,
            Guid dailyLogId,
            Guid farmId,
            Guid plotId,
            Guid cropCycleId,
            Guid operatorUserId,
            Guid sourceAiJobId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // /sync/push is on TenantTransactionMiddleware's admin skip-list: the
        // request runs admin-elevated with NO farm GUC set by the middleware.
        var tenant = sp.GetRequiredService<TenantContext>();
        tenant.ElevateToAdminCrossTenant();

        var handler = sp.GetRequiredService<PushSyncBatchHandler>();

        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = farmId,
            ["plotId"] = plotId,
            ["cropCycleId"] = cropCycleId,
            ["operatorUserId"] = operatorUserId,
            ["logDate"] = new DateOnly(2026, 6, 20).ToString("yyyy-MM-dd"),
            ["sourceAiJobId"] = sourceAiJobId,
        };
        var payloadElement = JsonSerializer.SerializeToElement(payload);

        var command = new PushSyncBatchCommand(
            DeviceId: deviceId,
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", payloadElement),
            },
            AppVersion: "1.2.3");

        return await handler.HandleAsync(command);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers (mirror LedgerDerivationSupersessionRealPostgresTests).
    // ─────────────────────────────────────────────────────────────────────────

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

    private static async Task SeedAiJobAsync(
        NpgsqlConnection db, Guid jobId, Guid farmId, Guid userId, string idempotencyKey, string normalizedJson)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
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
            """;
        cmd.Parameters.AddWithValue("id", jobId);
        cmd.Parameters.AddWithValue("key", idempotencyKey);
        cmd.Parameters.AddWithValue("uid", userId);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("json", normalizedJson);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedAiJobAttemptAsync(NpgsqlConnection db, Guid attemptId, Guid jobId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.ai_job_attempts (
                id, ai_job_id, attempt_number, provider, is_success, failure_class,
                latency_ms, attempted_at_utc, source, model_version, prompt_version)
            VALUES (
                @id, @job, 1, 'Gemini', true, 'None',
                100, NOW(), 'voice', 'gemini-2.5-flash', 'v3.2.0');
            """;
        cmd.Parameters.AddWithValue("id", attemptId);
        cmd.Parameters.AddWithValue("job", jobId);
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
