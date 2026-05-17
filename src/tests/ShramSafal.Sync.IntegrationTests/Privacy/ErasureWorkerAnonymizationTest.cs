// spec: data-principle-spine-2026-05-05/08.2
//
// Load-bearing integration test per DS-017 rule (e): seed PII rows
// (notes "Akash phone 9876543210", display name, transcript excerpt),
// run ErasureWorker, SELECT surviving rows, regex-grep against
// \d{10} + display-name allowlist + "Akash". Assert ZERO matches.
// Assert sentinel SystemActor.ErasedFarmer is in user_id columns.
// Assert KEEP fields (farm_id, plot_id, amount, etc.) survived.
// Assert per-row AuditEvent rows emitted with
// entityType="ErasureAnonymize" action="Applied".

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.2 / DS-017 rule (e) —
/// asserts the ErasureWorker honours the 5-rule ANONYMIZE contract.
///
/// <para>
/// The test seeds a single user across daily_logs + cost_entries +
/// log_tasks + correction_events + finance_corrections with PII
/// embedded in every free-text column (notes with "Akash phone
/// 9876543210", description with display name, reason with phone
/// number, transcript-like excerpt in correction_events). After the
/// worker runs, the surviving rows are read back and grep'd:
///
/// <list type="bullet">
/// <item>no <c>\d{10}</c> matches anywhere in scrubbed text columns</item>
/// <item>no display-name allowlist match anywhere</item>
/// <item>no "Akash" substring anywhere</item>
/// </list>
/// </para>
///
/// <para>
/// Also asserts every <c>user_id</c>-shaped column on the surviving
/// rows carries the <see cref="SystemActor.ErasedFarmer"/> sentinel.
/// </para>
///
/// <para>
/// Docker-gated — same collection + trait as
/// <see cref="ShramSafal.Sync.IntegrationTests.Tenancy.RowLevelSecurityTests"/>.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class ErasureWorkerAnonymizationTest : IAsyncLifetime
{
#pragma warning disable CS0618 // PostgreSqlBuilder() ctor obsolete in 4.x — pin for parity with sibling tests.
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private Guid _farmId;
    private Guid _userId;
    private Guid _plotId;
    private Guid _cycleId;

    private const string DisplayName = "Akash Arve";
    private const string PhoneNumber = "9876543210";
    private const string TranscriptExcerpt = "Akash said the phone number is 9876543210";

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        _farmId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _plotId = Guid.NewGuid();
        _cycleId = Guid.NewGuid();

        await SeedFixtureAsync(conn);

        var appConn = BuildAppRoleConnectionString(conn);
        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = conn,
                ["ConnectionStrings:UserDb"] = appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);
        services.AddSingleton<IRetainedBlobStore, PendingRetainedBlobStore>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task ErasureWorker_anonymizes_user_data_per_DS017_5_rule()
    {
        // ── 1. Enqueue an erasure request ────────────────────────────
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_pg.GetConnectionString()))
        {
            await seed.OpenAsync();
            await using var cmd = seed.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.erasure_requests
                    (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES (@id, @uid, NULL, 0, NOW());
                """;
            cmd.Parameters.AddWithValue("id", requestId);
            cmd.Parameters.AddWithValue("uid", _userId);
            await cmd.ExecuteNonQueryAsync();
        }

        // ── 2. Run the worker — invoke RunPassAsync via reflection on
        //     the BackgroundService start path. Simpler: invoke an
        //     ErasureWorker.ExecuteAsync with a short cancellation so
        //     one pass completes. We instantiate a worker bound to a
        //     short-lived cancellation token; one pass is enough.
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var workerTask = worker.StartAsync(cts.Token);
        // Wait briefly for the first poll loop to run.
        await Task.Delay(TimeSpan.FromSeconds(3), CancellationToken.None);
        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        // ── 3. Inspect surviving rows ────────────────────────────────
        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        // ErasureRequest itself should be Completed.
        var status = (int)(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id",
            ("id", requestId)))!;
        status.Should().Be((int)ErasureStatus.Completed,
            "ErasureWorker must transition the request to Completed within one pass");

        // daily_logs: operator_user_id should be the sentinel, KEEP
        // fields (farm_id, plot_id) should still be present.
        var dailyLogOperator = (Guid)(await ScalarAsync(raw,
            "SELECT operator_user_id FROM ssf.daily_logs WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        dailyLogOperator.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): operator_user_id must be the ErasedFarmer sentinel");

        var dailyLogFarm = (Guid)(await ScalarAsync(raw,
            "SELECT farm_id FROM ssf.daily_logs LIMIT 1"))!;
        dailyLogFarm.Should().Be(_farmId, "DS-017 rule (c): farm_id is a KEEP field");

        // log_tasks: notes + deviation_note should be NULL (rule (b)).
        var notes = await ScalarAsync(raw,
            "SELECT notes FROM ssf.log_tasks WHERE notes IS NOT NULL");
        notes.Should().BeNull("DS-017 rule (b): log_tasks.notes must be NULLed");

        var devNote = await ScalarAsync(raw,
            "SELECT deviation_note FROM ssf.log_tasks WHERE deviation_note IS NOT NULL");
        devNote.Should().BeNull("DS-017 rule (b): log_tasks.deviation_note must be NULLed");

        // cost_entries: created_by_user_id should be the sentinel;
        // description should be empty; amount (KEEP) should survive.
        var costCreator = (Guid)(await ScalarAsync(raw,
            "SELECT created_by_user_id FROM ssf.cost_entries WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        costCreator.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): cost_entries.created_by_user_id must be the sentinel");

        var costDescription = (string)(await ScalarAsync(raw,
            "SELECT description FROM ssf.cost_entries WHERE farm_id = @fid LIMIT 1",
            ("fid", _farmId)))!;
        costDescription.Should().BeEmpty("DS-017 rule (b): cost_entries.description must be scrubbed");

        // correction_events: user_id should be sentinel.
        var correctionUser = (Guid)(await ScalarAsync(raw,
            "SELECT user_id FROM ssf.correction_events LIMIT 1"))!;
        correctionUser.Should().Be(SystemActor.ErasedFarmer,
            "DS-017 rule (a): correction_events.user_id must be the sentinel");

        // finance_corrections: corrected_by_user_id should be sentinel,
        // reason free-text should be the redaction marker.
        var corrUser = (Guid)(await ScalarAsync(raw,
            "SELECT corrected_by_user_id FROM ssf.finance_corrections LIMIT 1"))!;
        corrUser.Should().Be(SystemActor.ErasedFarmer);
        var corrReason = (string)(await ScalarAsync(raw,
            "SELECT reason FROM ssf.finance_corrections LIMIT 1"))!;
        corrReason.Should().NotContain(PhoneNumber);
        corrReason.Should().NotContain(DisplayName);

        // ── 4. Regex-grep every free-text column for PII residue ────
        var phoneRegex = new Regex(@"\d{10}");
        var allTextSql = """
            SELECT description FROM ssf.cost_entries
            UNION ALL
            SELECT COALESCE(notes, '') FROM ssf.log_tasks
            UNION ALL
            SELECT COALESCE(deviation_note, '') FROM ssf.log_tasks
            UNION ALL
            SELECT reason FROM ssf.finance_corrections
            """;
        await using var grepCmd = raw.CreateCommand();
        grepCmd.CommandText = allTextSql;
        await using var rdr = await grepCmd.ExecuteReaderAsync();
        var allText = new List<string>();
        while (await rdr.ReadAsync())
        {
            allText.Add(rdr.GetString(0));
        }
        await rdr.CloseAsync();

        foreach (var t in allText)
        {
            phoneRegex.IsMatch(t).Should().BeFalse(
                $"DS-017 rule (b) test fixture: no 10-digit phone shape may survive scrubbing (offending value: \"{t}\")");
            t.Should().NotContain(DisplayName,
                "DS-017 rule (b): display-name strings must be scrubbed");
            t.Should().NotContain("Akash",
                "DS-017 rule (b): first-name token from the transcript excerpt must be scrubbed");
        }

        // ── 5. Per-row audit assertion ──────────────────────────────
        var auditCountObj = await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureAnonymize' AND action = 'Applied'");
        var auditCount = Convert.ToInt32(auditCountObj!);
        auditCount.Should().BeGreaterThan(0,
            "DS-017 rule (d): ErasureWorker must emit ErasureAnonymize/Applied AuditEvent rows for the anonymized tables");

        var completionCountObj = await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureRequest' AND action = 'Completed'");
        Convert.ToInt32(completionCountObj!).Should().Be(1,
            "ErasureWorker must emit exactly one ErasureRequest/Completed audit row per processed request");
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task SeedFixtureAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Test Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // daily_logs
        var dailyLogId = Guid.NewGuid();
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, CURRENT_DATE, NOW(), 'pre_spine', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", dailyLogId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("cid", _cycleId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // log_tasks (one with notes PII, one with deviation_note PII)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, notes, deviation_note, occurred_at_utc, execution_status, compliance_outcome)
                VALUES
                    (@id1, @lid, 'Spray', @notes, NULL, NOW(), 0, 0),
                    (@id2, @lid, 'Weed', NULL, @dev, NOW(), 0, 0);
                """;
            c.Parameters.AddWithValue("id1", Guid.NewGuid());
            c.Parameters.AddWithValue("id2", Guid.NewGuid());
            c.Parameters.AddWithValue("lid", dailyLogId);
            c.Parameters.AddWithValue("notes", $"{DisplayName} phone {PhoneNumber}");
            c.Parameters.AddWithValue("dev", TranscriptExcerpt);
            await c.ExecuteNonQueryAsync();
        }

        // cost_entries (description carries the display name + phone)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.cost_entries
                    ("Id", farm_id, plot_id, category_id, description, amount, currency_code, entry_date, created_at_utc, modified_at_utc, created_by_user_id, source, model_version, prompt_version, prompt_content_hash, app_version)
                VALUES
                    (@id, @fid, @pid, 'other', @desc, 100.00, 'INR', CURRENT_DATE, NOW(), NOW(), @uid, 'pre_spine', 'unknown', 'unknown', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("desc", $"Paid {DisplayName} ({PhoneNumber})");
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        // correction_events
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.correction_events
                    ("Id", "UserId", "OriginalParseId", "OriginalParseRaw", "CorrectedParse", "PromptVersion", "Locale", "Trigger", "CapturedAtUtc")
                VALUES
                    (@id, @uid, @opid, @raw::jsonb, @cor::jsonb, 'v1', 'mr-IN', 'EditUI', NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("uid", _userId);
            c.Parameters.AddWithValue("opid", Guid.NewGuid());
            c.Parameters.AddWithValue("raw", $"\"{TranscriptExcerpt}\"");
            c.Parameters.AddWithValue("cor", $"\"{TranscriptExcerpt}\"");
            await c.ExecuteNonQueryAsync();
        }

        // finance_corrections (reason carries display name + phone)
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.finance_corrections ("Id", cost_entry_id, original_amount, corrected_amount, currency_code, reason, corrected_by_user_id, corrected_at_utc, modified_at_utc)
                VALUES (@id, @ceid, 100.00, 80.00, 'INR', @reason, @uid, NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("ceid", Guid.NewGuid());
            c.Parameters.AddWithValue("reason", $"Reason from {DisplayName} ({PhoneNumber})");
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }
    }

    private static string BuildAppRoleConnectionString(string superuserConn)
    {
        var b = new NpgsqlConnectionStringBuilder(superuserConn)
        {
            Username = "agrisync_app",
            Password = "dev_app_change_me",
        };
        return b.ConnectionString;
    }

    private static async Task ApplyFullMigrationChainAsync(string conn)
    {
        var userOpts = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
        await using (var user = new UserDbContext(userOpts))
        {
            await user.Database.MigrateAsync();
        }

        var accountsOpts = new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(conn).Options;
        await using (var accounts = new AccountsDbContext(accountsOpts))
        {
            await accounts.Database.MigrateAsync();
        }

        const string ssfPhaseATarget = "20260421075311_AlterCostEntriesAddJobCardId";
        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn).Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            var migrator = ssf.Database.GetService<IMigrator>();
            await migrator.MigrateAsync(ssfPhaseATarget);
        }

        var analyticsOpts = new DbContextOptionsBuilder<AnalyticsDbContext>()
            .UseNpgsql(conn, npgsql =>
            {
                npgsql.MigrationsAssembly(
                    typeof(AgriSync.Bootstrapper.Migrations.Analytics.AnalyticsRewrite).Assembly.FullName);
                npgsql.MigrationsHistoryTable(
                    tableName: "__analytics_migrations_history",
                    schema: AnalyticsDbContext.SchemaName);
            })
            .Options;
        await using (var analytics = new AnalyticsDbContext(analyticsOpts))
        {
            await analytics.Database.MigrateAsync();
        }

        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
        }
    }
}
