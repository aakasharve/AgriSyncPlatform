// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b)
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
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — the end-to-end proof
/// that a MANUAL-entry day now persists what the farmer entered, and therefore scores.
///
/// <para><b>The defect, as observed in live data.</b> Every voice log persisted a typed
/// child; every manual log persisted none. The manual draft never left the client, so the
/// server had nothing to normalise; <c>LedgerDerivationService</c> (sole writer of
/// <c>labour_assignments</c> / <c>irrigation_entries</c> / <c>machinery_usages</c>) needed
/// an <c>AiJob</c> and a hand-typed day has none. <c>PersistedDayRootBuilder</c> therefore
/// projected an empty root, <c>DfesLensExtractor</c> saw an empty day, and a farmer who had
/// typed out everything he did was told ०/१०.</para>
///
/// <para><b>Why this test must be real Postgres on the real sync path.</b> The existing
/// sync-endpoint tests drive an EF in-memory harness where RLS does not exist, and it was
/// exactly that blind spot which let the dormant-ledger gap survive. This drives the ACTUAL
/// <see cref="PushSyncBatchHandler"/> resolved from the production <c>AddShramSafalApi</c>
/// graph, connected as the non-superuser <c>agrisync_app</c> role so FORCE-RLS genuinely
/// applies, and sets no farm GUC itself — the handler is solely responsible for it, exactly
/// as in production.</para>
///
/// <para><b>The control is the point.</b> Proof 2 pushes the identical mutation with NO
/// draft and asserts the OLD behaviour verbatim: zero typed children, an unaccounted day.
/// Side by side with proof 1 that is the defect and its fix in one run — and it is also the
/// guard that older clients (which never send a draft) keep working unchanged.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its OWN scratch database,
/// applies the full migration chain, drops it on dispose; never touches
/// <c>agrisync_dfes</c>. If Postgres :5433 is genuinely unreachable it skips and SAYS SO
/// loudly — a skipped proof is not a passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class SyncPushManualDraftRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0b000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0b000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0b000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0b000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0b000000-0000-0000-0000-000000000005");

    // One date per proof so the two never contend on ux_daily_richness_farm_local_date.
    private static readonly DateOnly WithDraftDate = new(2026, 8, 14);
    private static readonly DateOnly WithoutDraftDate = new(2026, 8, 15);

    /// <summary>
    /// A real typed day, in the shape the manual-entry screen builds. The labour row
    /// states a rate and a head-count but NO total — 5 x 350 is a number the farmer never
    /// said, and it must not appear anywhere downstream (P4).
    /// </summary>
    private static Dictionary<string, object?> FarmersTypedDay() => new()
    {
        ["labour"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["id"] = "lb-0", ["type"] = "HIRED",
                ["maleCount"] = 2, ["femaleCount"] = 3, ["count"] = 5, ["rate"] = 350,
            },
        },
        ["irrigation"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["id"] = "irr-0", ["method"] = "drip", ["source"] = "borewell",
                ["durationHours"] = 2.5,
            },
        },
        ["machinery"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["id"] = "mc-0", ["type"] = "sprayer", ["ownership"] = "owned",
                ["hoursUsed"] = 3, ["rentalCost"] = 800,
            },
        },
        ["observations"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["id"] = "ob-0", ["textRaw"] = "खोडांवरती काळा डाग दिसतोय", ["noteType"] = "issue",
            },
        },
        ["inputs"] = new[]
        {
            new Dictionary<string, object?>
            {
                ["id"] = "in-0", ["type"] = "fertilizer",
                ["mix"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "m0", ["productName"] = "MKP", ["npkGrade"] = "0:52:34",
                        ["dose"] = 4, ["unit"] = "kg",
                    },
                },
            },
        },
    };

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
        _scratchDbName = $"ssf_manual_draft_{Guid.NewGuid():N}";
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

    private bool SkippedForMissingPostgres()
    {
        if (!_skip)
        {
            return false;
        }

        output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        Assert.True(true, _skipReason);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — a manual day WITH a draft persists typed children and scores.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Manual_create_daily_log_with_a_draft_persists_typed_children_and_the_day_scores()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("0bbb1111-1111-1111-1111-111111111111");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-manual-draft",
            dailyLogId: dailyLogId,
            logDate: WithDraftDate,
            manualDraft: FarmersTypedDay());

        response.IsSuccess.Should().BeTrue("the /sync/push batch call must succeed");
        var mutationResult = Assert.Single(response.Value!.Results);
        output.WriteLine(
            $"[EVIDENCE] mutation status='{mutationResult.Status}' errorCode='{mutationResult.ErrorCode}' errorMessage='{mutationResult.ErrorMessage}'");
        mutationResult.Status.Should().Be("applied",
            "the allowlist must ACCEPT the new manualDraft field, not reject the mutation");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        // The handler wrote as a NON-superuser role, so FORCE-RLS genuinely applied.
        await using (var appCheck = new NpgsqlConnection(_appConn))
        {
            await appCheck.OpenAsync();
            var isSuper = Convert.ToBoolean(await ScalarAsync(appCheck,
                "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
            isSuper.Should().BeFalse("the write path must not be a superuser-vacuous pass");
            output.WriteLine($"[EVIDENCE] handler role superuser_or_bypassrls = {isSuper} (expect False)");
        }

        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId)))
            .Should().Be(1, "the daily_log itself must be durable");

        var labour = await CountAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", dailyLogId));
        var irrigation = await CountAsync(read,
            "SELECT COUNT(*) FROM ssf.irrigation_entries WHERE daily_log_id = @id", ("id", dailyLogId));
        var machinery = await CountAsync(read,
            "SELECT COUNT(*) FROM ssf.machinery_usages WHERE daily_log_id = @id", ("id", dailyLogId));
        var observations = await CountAsync(read,
            "SELECT COUNT(*) FROM ssf.observation_events WHERE daily_log_id = @id", ("id", dailyLogId));
        var operations = await CountAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_operations WHERE source_daily_log_id = @id AND is_current_version",
            ("id", dailyLogId));

        labour.Should().Be(1, "THE defect — a manual day's labour must reach labour_assignments");
        irrigation.Should().Be(1, "…and his irrigation must reach irrigation_entries");
        machinery.Should().Be(1, "…and his machine use must reach machinery_usages");
        observations.Should().Be(1, "…and what he noticed must reach observation_events");
        operations.Should().Be(1, "…and his application must reach farm_operations");

        // P4 — the total he never entered must not exist. P8 — these rows say "manual".
        var labourTotal = await ScalarAsync(read,
            "SELECT total_cost FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", dailyLogId));
        (labourTotal is null or DBNull).Should().BeTrue(
            "5 workers at 350 is an INFERENCE; no total was entered so none may be stored");

        await using (var prov = read.CreateCommand())
        {
            prov.CommandText =
                "SELECT source, model_version, prompt_version FROM ssf.farm_operations WHERE source_daily_log_id = @id AND is_current_version";
            prov.Parameters.AddWithValue("id", dailyLogId);
            await using var reader = await prov.ExecuteReaderAsync();
            (await reader.ReadAsync()).Should().BeTrue();
            var source = reader.GetString(0);
            var modelVersion = reader.GetString(1);
            var promptVersion = reader.GetString(2);
            source.Should().Be("manual", "no AI touched this row — 'voice' would be a provenance lie (P8)");
            modelVersion.Should().Be("n/a", "there was no model");
            promptVersion.Should().Be("n/a", "there was no prompt");
            output.WriteLine($"[EVIDENCE] farm_operations provenance: source='{source}' model='{modelVersion}' prompt='{promptVersion}'");
        }

        var observationSource = Convert.ToString(await ScalarAsync(read,
            "SELECT source FROM ssf.observation_events WHERE daily_log_id = @id", ("id", dailyLogId)));
        observationSource.Should().Be("Manual", "a note he typed is not a note he spoke");

        // The number the farmer is actually shown.
        var (score, classification, hasWork) = await ReadDayScoreAsync(read, WithDraftDate);
        hasWork.Should().BeTrue("he worked, and the day must say so");
        classification.Should().NotBe(nameof(DayClassification.UnaccountedDay),
            "the day must no longer be classified as 'nothing happened'");
        score.Should().NotBeNull("a day with scorable work must produce a number");
        score!.Value.Should().BeGreaterThan(0, "THE defect — the farmer's typed day must no longer read ०/१०");
        score.Value.Should().BeInRange(0, 10, "the farmer-facing score is a 0-10 scale");

        output.WriteLine("[EVIDENCE] === manual draft derivation (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] labour_assignments      = {labour} (expect 1)");
        output.WriteLine($"[EVIDENCE] irrigation_entries      = {irrigation} (expect 1)");
        output.WriteLine($"[EVIDENCE] machinery_usages        = {machinery} (expect 1)");
        output.WriteLine($"[EVIDENCE] observation_events      = {observations} (expect 1)");
        output.WriteLine($"[EVIDENCE] current farm_operations = {operations} (expect 1)");
        output.WriteLine($"[EVIDENCE] day understanding score = {score}/10 (expect > 0); classification='{classification}'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — CONTROL. No draft ⇒ the pre-task-0b behaviour, verbatim.
    // This is both the defect reproduced and the old-client compatibility guard.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Manual_create_daily_log_without_a_draft_still_persists_nothing_and_scores_zero()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("0bbb2222-2222-2222-2222-222222222222");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-manual-no-draft",
            dailyLogId: dailyLogId,
            logDate: WithoutDraftDate,
            manualDraft: null);

        Assert.Single(response.Value!.Results).Status.Should().Be("applied",
            "a client that sends no draft must keep working exactly as before");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", dailyLogId)))
            .Should().Be(1, "the log still commits");
        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", dailyLogId)))
            .Should().Be(0, "no draft means nothing to derive — the untouched legacy path");
        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.irrigation_entries WHERE daily_log_id = @id", ("id", dailyLogId)))
            .Should().Be(0);
        (await CountAsync(read, "SELECT COUNT(*) FROM ssf.farm_operations WHERE source_daily_log_id = @id", ("id", dailyLogId)))
            .Should().Be(0);

        var (score, classification, hasWork) = await ReadDayScoreAsync(read, WithoutDraftDate);
        hasWork.Should().BeFalse();
        classification.Should().Be(nameof(DayClassification.UnaccountedDay),
            "THIS is the bug as the farmer met it — kept here as the control that proves proof 1 is not vacuous");

        output.WriteLine("[EVIDENCE] === control: same mutation, no draft (the pre-fix behaviour) ===");
        output.WriteLine($"[EVIDENCE] typed children = 0; classification='{classification}'; score={(score?.ToString() ?? "null")}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — the boundary still rejects what it should, loudly.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_genuinely_unknown_payload_field_is_still_rejected()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var response = await RunSyncPushAsync(
            clientRequestId: "req-unknown-field",
            dailyLogId: Guid.Parse("0bbb3333-3333-3333-3333-333333333333"),
            logDate: new DateOnly(2026, 8, 16),
            manualDraft: null,
            extraPayloadField: ("somethingNobodyDefined", "x"));

        var result = Assert.Single(response.Value!.Results);
        result.Status.Should().Be("failed",
            "widening the allowlist for manualDraft must not have opened it to everything else");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        output.WriteLine($"[EVIDENCE] unknown top-level field → status='{result.Status}' code='{result.ErrorCode}'");
    }

    [Fact]
    public async Task An_unknown_bucket_inside_the_draft_is_rejected_rather_than_silently_dropped()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var draft = FarmersTypedDay();
        draft["somethingNobodyDefined"] = new[] { new Dictionary<string, object?> { ["id"] = "x" } };

        var response = await RunSyncPushAsync(
            clientRequestId: "req-unknown-bucket",
            dailyLogId: Guid.Parse("0bbb4444-4444-4444-4444-444444444444"),
            logDate: new DateOnly(2026, 8, 17),
            manualDraft: draft);

        var result = Assert.Single(response.Value!.Results);
        result.Status.Should().Be("failed",
            "a bucket the server has no meaning for must be REFUSED, never quietly discarded — " +
            "a farmer whose day was silently halved is the failure this task exists to end");
        result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        output.WriteLine($"[EVIDENCE] unknown draft bucket → status='{result.Status}' code='{result.ErrorCode}'");
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
            "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'ssf_manual_draft_%'"));

        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var tables = Convert.ToInt64(await ScalarAsync(scratch,
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ssf'"));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created  = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] live ssf_manual_draft_* DBs = {scratchCount} (expect >= 1 during this run)");
        output.WriteLine($"[PROVISIONING] ssf tables after migrations = {tables} (expect many; 0 would mean no chain ran)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        tables.Should().BeGreaterThan(10, "the migration chain must genuinely have been applied");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Drives the ACTUAL PushSyncBatchHandler under the production /sync/push
    // posture: admin-elevate TenantContext (what TenantTransactionMiddleware's
    // skip-list does) and let the handler establish the farm GUC itself.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        string clientRequestId,
        Guid dailyLogId,
        DateOnly logDate,
        Dictionary<string, object?>? manualDraft,
        (string Name, object Value)? extraPayloadField = null)
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
        if (extraPayloadField is { } extra)
        {
            payload[extra.Name] = extra.Value;
        }

        var command = new PushSyncBatchCommand(
            DeviceId: "device-manual-draft",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "owner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.2.3");

        return await handler.HandleAsync(command);
    }

    /// <summary>
    /// Reads the day's persisted aggregate and re-derives the farmer-facing /10 from its
    /// <c>components_json</c> using the REAL Domain rollup — the same number the client is
    /// shown, not a test-local approximation of it.
    /// </summary>
    private static async Task<(int? Score, string Classification, bool HasWork)> ReadDayScoreAsync(
        NpgsqlConnection db, DateOnly localDate)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT day_classification, has_work, components_json
            FROM ssf.daily_richness_aggregates
            WHERE farm_id = @farm AND local_date = @d
            """;
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", localDate);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue(
            "the richness recompute must have written an aggregate for {0}", localDate);

        var classification = reader.GetString(0);
        var hasWork = reader.GetBoolean(1);
        var componentsJson = reader.GetString(2);

        var input = JsonSerializer.Deserialize<LensInput>(componentsJson);
        var score = input is null ? null : DayUnderstandingScore.From(input);
        return (score, classification, hasWork);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────

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
            VALUES (@id, 'Manual Draft Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
