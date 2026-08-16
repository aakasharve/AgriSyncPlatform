// spec: dfes-companion-2026-07-11 (wave-3.10)
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

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// FOUNDER DECISION 8 (2026-08-16) — <b>a spoken "no work today", with reason chips
/// after.</b>
///
/// <para><b>The gap.</b> The acknowledgement for a declared no-work day has been live for
/// VOICE days only: <c>DfesLensExtractor.DeclaredNoWork</c> reads <c>dayOutcome</c> off the
/// AI job's wire root, and nothing on the typed path ever produced one. The
/// <c>आज काम नाही</c> button opened a blank manual screen, and a farmer whose day was
/// rained off had no way to say so in writing.</para>
///
/// <para><b>Six layers had to join up, and the fifth is the one nobody named.</b> The
/// normaliser's output goes to <c>LedgerDerivationService</c> — the ledger writer — and
/// NEVER to the scorer. The scorer's roots come from the AI job plus
/// <c>PersistedDayRootBuilder</c>, which emitted no <c>dayOutcome</c> at all. A perfectly
/// wired contract would still not have reached <c>DeclaredNoWork</c>. That is why these
/// proofs assert on <c>ssf.daily_richness_aggregates</c> — the SCORER's output — and not
/// on the ledger tables: only the aggregate can tell the two apart.</para>
///
/// <para><b>Doctrine P9 — no optional field may reject a record.</b> Proof 1 sends NO
/// chip. The declaration must still commit and must still be read as a declared no-work
/// day. That is exactly why the declaration itself is <c>dayOutcome</c> on the log and not
/// a <c>DisturbanceEvent</c>: <c>DisturbanceEvent.Create</c> requires a non-empty reason,
/// so a chip-less declaration expressed that way would be silently dropped, and a
/// chip-BEARING one would set <c>HasDisturbance</c> and report the day as
/// <c>blocked</c> rather than <c>rest</c> — recording the wrong fact (P3/P8).</para>
///
/// <para><b>The control is the point.</b> Proof 3 pushes an ordinary work day and asserts
/// the flag stays FALSE. Without it, proofs 1 and 2 would both pass against a server that
/// simply set the flag on every log.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its OWN scratch database,
/// applies the full migration chain, drops it on dispose. A run without Postgres reports
/// SKIPPED, never Passed — a skipped proof is not a passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DeclaredNoWorkDayTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0d000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0d000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0d000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0d000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0d000000-0000-0000-0000-000000000005");

    // One date per proof — ux_daily_richness_farm_local_date is unique per (farm, day).
    private static readonly DateOnly NoChipsDate = new(2026, 8, 20);
    private static readonly DateOnly WithChipDate = new(2026, 8, 21);
    private static readonly DateOnly WorkDate = new(2026, 8, 22);

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — P9. He tapped "आज काम नाही" and skipped the chips.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_declared_no_work_day_reaches_the_scorer_with_no_chips()
    {
        SkipIfPostgresUnavailable();
        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("0ddd1111-1111-1111-1111-111111111111");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-no-work-bare",
            dailyLogId: dailyLogId,
            logDate: NoChipsDate,
            manualDraft: new Dictionary<string, object?> { ["dayOutcome"] = "NO_WORK_PLANNED" });

        var mutation = Assert.Single(response.Value!.Results);
        output.WriteLine($"[EVIDENCE] mutation status='{mutation.Status}' code='{mutation.ErrorCode}' msg='{mutation.ErrorMessage}'");
        mutation.Status.Should().Be("applied",
            "the sync boundary must ACCEPT a non-bucket scalar key, not reject the whole day");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        // The declaration is durable on the log itself — a canonical fact, not a
        // best-effort side-car value.
        var stored = Convert.ToString(await ScalarAsync(read,
            "SELECT day_outcome FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId)));
        stored.Should().Be("NO_WORK_PLANNED", "layer 5 can only bridge what layer 4 stored");

        // No chip was given, so no DisturbanceEvent exists — and the record committed anyway.
        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.disturbance_events WHERE daily_log_id = @id", ("id", dailyLogId)))
            .Should().Be(0, "P9 — an absent optional chip writes nothing and rejects nothing");

        var (declared, reasonCode, classification) = await ReadDayAsync(read, NoChipsDate);
        declared.Should().BeTrue("P9 — an optional chip may never reject the record");
        reasonCode.Should().Be("rest",
            "he declared a rest day; 'blocked' would be a fact he never stated (P3/P8)");

        output.WriteLine("[EVIDENCE] === chip-less declaration ===");
        output.WriteLine($"[EVIDENCE] daily_logs.day_outcome        = '{stored}'");
        output.WriteLine($"[EVIDENCE] has_declared_no_work_reason   = {declared} (expect True)");
        output.WriteLine($"[EVIDENCE] no_work_reason_code           = '{reasonCode}' (expect 'rest')");
        output.WriteLine($"[EVIDENCE] day_classification            = '{classification}'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — the chip rides as a DisturbanceEvent and names the cause.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_reason_chip_rides_as_a_DisturbanceEvent_and_names_the_cause()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("0ddd2222-2222-2222-2222-222222222222");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-no-work-chip",
            dailyLogId: dailyLogId,
            logDate: WithChipDate,
            manualDraft: new Dictionary<string, object?>
            {
                ["dayOutcome"] = "NO_WORK_PLANNED",
                ["disturbance"] = new Dictionary<string, object?>
                {
                    ["scope"] = "FULL_DAY",
                    ["cause"] = "weather",
                    ["reason"] = "पाऊस होता",
                },
            });

        Assert.Single(response.Value!.Results).Status.Should().Be("applied");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.disturbance_events WHERE daily_log_id = @id", ("id", dailyLogId)))
            .Should().Be(1, "the chip maps onto the EXISTING DisturbanceCause vocabulary — no new table");

        var storedReason = Convert.ToString(await ScalarAsync(read,
            "SELECT reason FROM ssf.disturbance_events WHERE daily_log_id = @id", ("id", dailyLogId)));
        storedReason.Should().Be("पाऊस होता", "his own words, verbatim");

        var (declared, reasonCode, _) = await ReadDayAsync(read, WithChipDate);
        declared.Should().BeTrue();
        reasonCode.Should().Be("weather", "the chip names the cause the day is remembered by");

        output.WriteLine("[EVIDENCE] === declaration + one reason chip ===");
        output.WriteLine($"[EVIDENCE] disturbance_events.reason = '{storedReason}'");
        output.WriteLine($"[EVIDENCE] no_work_reason_code       = '{reasonCode}' (expect 'weather')");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — CONTROL. An ordinary work day is untouched.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_work_day_is_unaffected()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("0ddd3333-3333-3333-3333-333333333333");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-ordinary-work",
            dailyLogId: dailyLogId,
            logDate: WorkDate,
            manualDraft: new Dictionary<string, object?>
            {
                ["labour"] = new[]
                {
                    new Dictionary<string, object?> { ["id"] = "lb-0", ["count"] = 3, ["totalCost"] = 900 },
                },
            });

        Assert.Single(response.Value!.Results).Status.Should().Be("applied");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var stored = await ScalarAsync(read,
            "SELECT day_outcome FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId));
        (stored is null or DBNull).Should().BeTrue(
            "an absent declaration stays absent — never defaulted to WORK_RECORDED (P4)");

        var (declared, reasonCode, _) = await ReadDayAsync(read, WorkDate);
        declared.Should().BeFalse(
            "THE control — without this, proofs 1 and 2 would pass against a server that flagged every log");
        reasonCode.Should().BeNull();

        output.WriteLine("[EVIDENCE] === control: an ordinary typed work day ===");
        output.WriteLine($"[EVIDENCE] daily_logs.day_outcome      = {(stored is null or DBNull ? "NULL" : stored)}");
        output.WriteLine($"[EVIDENCE] has_declared_no_work_reason = {declared} (expect False)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reads the SCORER's output — the only place the six layers can be seen joined.
    // ─────────────────────────────────────────────────────────────────────────
    private static async Task<(bool Declared, string? ReasonCode, string Classification)> ReadDayAsync(
        NpgsqlConnection db, DateOnly localDate)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT has_declared_no_work_reason, no_work_reason_code, day_classification
            FROM ssf.daily_richness_aggregates
            WHERE farm_id = @farm AND local_date = @d
            """;
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", localDate);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue(
            "the richness recompute must have written an aggregate for {0}", localDate);

        return (reader.GetBoolean(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetString(2));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness — identical posture to SyncPushManualDraftRealPostgresTests: the REAL
    // PushSyncBatchHandler from the production graph, connected as the non-superuser
    // agrisync_app role so FORCE-RLS genuinely applies.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        string clientRequestId,
        Guid dailyLogId,
        DateOnly logDate,
        Dictionary<string, object?>? manualDraft)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        var tenant = sp.GetRequiredService<TenantContext>();
        tenant.ElevateToAdminCrossTenant();

        var handler = sp.GetRequiredService<PushSyncBatchHandler>();

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
            DeviceId: "device-declared-no-work",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.2.3");

        return await handler.HandleAsync(command);
    }

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
        _scratchDbName = $"ssf_no_work_{Guid.NewGuid():N}";
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

    private async Task WriteProvisioningEvidenceAsync()
    {
        await using var admin = new NpgsqlConnection(_adminConn);
        await admin.OpenAsync();
        var scratchCount = Convert.ToInt64(await ScalarAsync(admin,
            "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'ssf_no_work_%'"));

        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var tables = Convert.ToInt64(await ScalarAsync(scratch,
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ssf'"));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created  = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] live ssf_no_work_* DBs     = {scratchCount} (expect >= 1 during this run)");
        output.WriteLine($"[PROVISIONING] ssf tables after migrations = {tables} (expect many; 0 would mean no chain ran)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        tables.Should().BeGreaterThan(10, "the migration chain must genuinely have been applied");
    }

    private static async Task<long> CountAsync(
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

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'Declared No-Work Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
