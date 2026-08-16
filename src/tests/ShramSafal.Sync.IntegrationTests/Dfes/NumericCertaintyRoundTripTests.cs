// spec: dfes-companion-2026-07-11 (wave-3.12)
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
using ShramSafal.Domain.Common;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// SPEC RULING 5 (2026-08-15) — <b>every number remembers how sure the farmer was.</b>
/// MANUAL HALF ONLY; the voice half is <c>BLOCKED — Gate C</c>.
///
/// <para><b>Why this is an end-to-end proof and not a unit test.</b>
/// <c>ManualDraftNormalizer</c> silently DROPS every key outside its per-bucket
/// allowlists — no error, no log line. A contract test would happily pass while the
/// farmer's "अंदाजे ५०० मिली" evaporated somewhere between the sync boundary and the
/// ledger. The only honest proof reads the columns back out of Postgres after a real
/// <c>/sync/push</c>.</para>
///
/// <para><b>Doctrine P8 — certainty is a DIFFERENT AXIS from provenance.</b> These are
/// their own nullable columns, never a fifth <c>FieldProvenance</c> member: a dose can be
/// spoken AND approximate at once.</para>
///
/// <para><b>Doctrine P4 — an unknown is never a zero.</b> Proof 2 states
/// <c>certainty: "unknown"</c> with no dose at all and requires <c>dose_amount</c> to come
/// back NULL. It must also never become a <c>CostEntry</c>: <c>CostEntry.Create</c> throws
/// on <c>amount &lt;= 0</c>, so the certainty column is the only place an unknown can
/// honestly live.</para>
///
/// <para><b>The control.</b> Proof 3 pushes the same day with no <c>numbers</c> map at all
/// and requires the columns to be NULL — "not asked, not stated", never <c>Reported</c>.
/// Without it, proofs 1 and 2 would pass against a server that stamped a certainty on
/// every row it wrote.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class NumericCertaintyRoundTripTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("0c000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("0c000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("0c000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("0c000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("0c000000-0000-0000-0000-000000000005");

    private static readonly DateOnly ApproximateDate = new(2026, 8, 24);
    private static readonly DateOnly UnknownDate = new(2026, 8, 25);
    private static readonly DateOnly PlainDate = new(2026, 8, 26);

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — an approximate dose survives persistence AND sync, words intact.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task An_approximate_dose_survives_persistence_and_sync()
    {
        SkipIfPostgresUnavailable();
        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("0ccc1111-1111-1111-1111-111111111111");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-approx-dose",
            dailyLogId: dailyLogId,
            logDate: ApproximateDate,
            manualDraft: new Dictionary<string, object?>
            {
                ["inputs"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "in-1",
                        ["type"] = "fungicide",
                        ["productName"] = "Mancozeb",
                        ["mix"] = new[]
                        {
                            new Dictionary<string, object?>
                            {
                                ["id"] = "m-1",
                                ["productName"] = "Mancozeb",
                                ["dose"] = 500,
                                ["unit"] = "ml",
                            },
                        },
                        // The qualifier rides the row the farmer edited; the dose itself
                        // lives on the mix item. The derivation joins the two.
                        ["numbers"] = new Dictionary<string, object?>
                        {
                            ["dose"] = new Dictionary<string, object?>
                            {
                                ["certainty"] = "approximate",
                                ["spokenText"] = "अंदाजे ५०० मिली",
                            },
                        },
                    },
                },
            });

        Assert.Single(response.Value!.Results).Status.Should().Be("applied");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var (amount, certainty, spoken) = await ReadInputItemAsync(read, dailyLogId);

        certainty.Should().Be(nameof(NumericCertainty.Approximate),
            "THE proof — ManualDraftNormalizer drops anything not allow-listed, silently");
        spoken.Should().Be("अंदाजे ५०० मिली", "his own words, verbatim");
        amount.Should().Be(500m, "he did state a figure; approximate is not absent");

        output.WriteLine("[EVIDENCE] === approximate dose, round-tripped ===");
        output.WriteLine($"[EVIDENCE] dose_amount      = {amount}");
        output.WriteLine($"[EVIDENCE] dose_certainty   = '{certainty}' (expect Approximate)");
        output.WriteLine($"[EVIDENCE] dose_spoken_text = '{spoken}'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — P4. "आठवत नाही" creates no numeric value, and never a zero.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Do_not_remember_creates_no_numeric_value()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("0ccc2222-2222-2222-2222-222222222222");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-unknown-dose",
            dailyLogId: dailyLogId,
            logDate: UnknownDate,
            manualDraft: new Dictionary<string, object?>
            {
                ["inputs"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "in-2",
                        ["type"] = "fungicide",
                        ["productName"] = "Mancozeb",
                        ["mix"] = new[]
                        {
                            new Dictionary<string, object?>
                            {
                                ["id"] = "m-2",
                                ["productName"] = "Mancozeb",
                                ["unit"] = "ml",
                            },
                        },
                        ["numbers"] = new Dictionary<string, object?>
                        {
                            ["dose"] = new Dictionary<string, object?>
                            {
                                ["certainty"] = "unknown",
                                ["spokenText"] = "आठवत नाही",
                            },
                        },
                    },
                },
            });

        Assert.Single(response.Value!.Results).Status.Should().Be("applied");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var (amount, certainty, spoken) = await ReadInputItemAsync(read, dailyLogId);

        amount.Should().BeNull("P4 — an unknown number is never zero");
        certainty.Should().Be(nameof(NumericCertainty.Unknown));
        spoken.Should().Be("आठवत नाही");

        // NOT asserted here, deliberately: "no CostEntry was written". ssf.cost_entries is
        // written by the finance endpoints and the job-card payout path — the daily-log
        // derivation never writes one — so a COUNT(*) of 0 would pass for EVERY input and
        // prove nothing. The CostEntry constraint (Create throws on amount <= 0) is why the
        // certainty columns are the only honest home for an unknown cost; it is recorded on
        // NumericCertainty and LabourAssignment.CostCertainty rather than pretended at here.

        output.WriteLine("[EVIDENCE] === 'आठवत नाही', round-tripped ===");
        output.WriteLine($"[EVIDENCE] dose_amount      = {(amount is null ? "NULL" : amount.ToString())} (expect NULL, never 0)");
        output.WriteLine($"[EVIDENCE] dose_certainty   = '{certainty}' (expect Unknown)");
        output.WriteLine($"[EVIDENCE] dose_spoken_text = '{spoken}'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — CONTROL. No `numbers` map ⇒ NULL, never Reported.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_number_nobody_qualified_stays_unqualified()
    {
        SkipIfPostgresUnavailable();

        var dailyLogId = Guid.Parse("0ccc3333-3333-3333-3333-333333333333");

        var response = await RunSyncPushAsync(
            clientRequestId: "req-no-numbers",
            dailyLogId: dailyLogId,
            logDate: PlainDate,
            manualDraft: new Dictionary<string, object?>
            {
                ["inputs"] = new[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = "in-3",
                        ["type"] = "fungicide",
                        ["productName"] = "Mancozeb",
                        ["mix"] = new[]
                        {
                            new Dictionary<string, object?>
                            {
                                ["id"] = "m-3", ["productName"] = "Mancozeb",
                                ["dose"] = 500, ["unit"] = "ml",
                            },
                        },
                    },
                },
                ["labour"] = new[]
                {
                    new Dictionary<string, object?> { ["id"] = "lb-3", ["count"] = 3, ["totalCost"] = 900 },
                },
            });

        Assert.Single(response.Value!.Results).Status.Should().Be("applied");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var (amount, certainty, spoken) = await ReadInputItemAsync(read, dailyLogId);

        amount.Should().Be(500m, "the number itself is untouched by this task");
        certainty.Should().BeNull(
            "THE control — a number nobody asked about must not come back claiming he was sure");
        spoken.Should().BeNull();

        var labourCertainty = await ScalarAsync(read,
            "SELECT cost_certainty FROM ssf.labour_assignments WHERE daily_log_id = @id", ("id", dailyLogId));
        (labourCertainty is null or DBNull).Should().BeTrue(
            "the same holds on every table that gained a column");

        output.WriteLine("[EVIDENCE] === control: the same day with no `numbers` map ===");
        output.WriteLine($"[EVIDENCE] dose_amount    = {amount} (unchanged)");
        output.WriteLine($"[EVIDENCE] dose_certainty = NULL; cost_certainty = NULL");
    }

    // ─────────────────────────────────────────────────────────────────────────
    private static async Task<(decimal? Amount, string? Certainty, string? Spoken)> ReadInputItemAsync(
        NpgsqlConnection db, Guid dailyLogId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT i.dose_amount, i.dose_certainty, i.dose_spoken_text
            FROM ssf.application_input_items i
            JOIN ssf.farm_operations op ON op."Id" = i.operation_id
            WHERE op.source_daily_log_id = @id AND op.is_current_version
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue(
            "the input item must have been derived at all — without a row there is nothing to prove");

        return (
            reader.IsDBNull(0) ? null : reader.GetDecimal(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2));
    }

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
            DeviceId: "device-numeric-certainty",
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
        _scratchDbName = $"ssf_certainty_{Guid.NewGuid():N}";
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
        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var certaintyColumns = Convert.ToInt64(await ScalarAsync(scratch, """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = 'ssf'
              AND column_name IN ('dose_certainty', 'water_certainty', 'cost_certainty',
                                  'dose_spoken_text', 'water_spoken_text', 'cost_spoken_text')
            """));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] certainty columns present = {certaintyColumns} (expect 8)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        certaintyColumns.Should().Be(8, "the wave-3.12 migration must genuinely have been applied");
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
            VALUES (@id, 'Numeric Certainty Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
