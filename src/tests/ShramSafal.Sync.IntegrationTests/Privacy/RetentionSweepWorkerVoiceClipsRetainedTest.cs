// spec: data-principle-spine-2026-05-05/phase-07-spine-hardening
//
// ADR-DS-009 §"Per-row sweep audit" — every retained voice clip
// removed by the retention sweep MUST emit one AuditEvent row with
// entityType="VoiceClipRetained" action="RetentionSweep" and the
// consent_token_kid in the payload.
//
// This test seeds:
//   - 2 users (UserA with consent withdrawn, UserB with consent live)
//   - 3 VoiceClipRetained rows for UserA + 1 for UserB
//   - UserConsentState rows matching consent intent
//   - In-memory IRetainedBlobStore (records per-user delete calls)
//
// Runs the worker once, then asserts:
//   - 3 rows deleted from ssf.voice_clips_retained for UserA
//   - 1 row preserved for UserB
//   - 1 RetentionSweepRun row with TablesSwept contains
//     "voice_clips_retained" and counts reflect the sweep
//   - 3 AuditEvent rows entityType="VoiceClipRetained"
//     action="RetentionSweep" each carrying UserA's CurrentTokenKid

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.Bootstrapper.Jobs;
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
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 07 spine-hardening / ADR-DS-009 —
/// verifies the <see cref="RetentionSweepWorker"/> sweeps
/// <c>ssf.voice_clips_retained</c> when consent is withdrawn AND
/// emits one per-row AuditEvent carrying <c>consentTokenKid</c> in
/// the payload.
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class RetentionSweepWorkerVoiceClipsRetainedTest : IAsyncLifetime
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
    private RecordingRetainedBlobStore _blobStore = default!;
    private readonly Guid _userA = Guid.NewGuid();
    private readonly Guid _userB = Guid.NewGuid();
    private const string UserAKid = "kid-2026-05-21-a";
    private const string UserBKid = "kid-2026-05-21-b";

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

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
                // Pin a small horizon so the test isn't sensitive to
                // RecordedAtUtc placement vs the default 5y window.
                ["Privacy:VoiceClipsRetained:MaxAgeDays"] = "1825",
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        // Recording blob-store fake — captures per-user delete calls and
        // performs the matching DB row delete so the worker's audit
        // emissions can observe the rows before they're gone.
        _blobStore = new RecordingRetainedBlobStore(inMemoryConfig);
        services.AddSingleton<IRetainedBlobStore>(_blobStore);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task RetentionSweepWorker_sweeps_voice_clips_retained_when_consent_withdrawn()
    {
        // Act — fire one worker pass via StartAsync + short cancellation
        // (mirrors ErasureWorkerAnonymizationTest pattern).
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var worker = new RetentionSweepWorker(
            scopeFactory,
            NullLogger<RetentionSweepWorker>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var workerTask = worker.StartAsync(cts.Token);
        // Wait briefly for the first pass to complete; RunPassAsync
        // executes synchronously at the top of ExecuteAsync.
        await Task.Delay(TimeSpan.FromSeconds(4), CancellationToken.None);
        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        // Assert
        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        var userARemaining = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.voice_clips_retained WHERE user_id = @uid",
            ("uid", _userA));
        userARemaining.Should().Be(0,
            "UserA has withdrawn consent; all 3 retained clips MUST be swept");

        var userBRemaining = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.voice_clips_retained WHERE user_id = @uid",
            ("uid", _userB));
        userBRemaining.Should().Be(1,
            "UserB has active consent; their clip MUST survive");

        var sweepRow = await ScalarStringAsync(raw,
            "SELECT tables_swept FROM ssf.retention_sweep_runs ORDER BY occurred_at_utc DESC LIMIT 1");
        sweepRow.Should().NotBeNullOrEmpty()
            .And.Contain("voice_clips_retained",
                "Phase 07 TablesSwept comma-list must include voice_clips_retained when any clip is swept");

        var sweepRows = await ScalarIntAsync(raw,
            "SELECT rows_removed_count FROM ssf.retention_sweep_runs ORDER BY occurred_at_utc DESC LIMIT 1");
        sweepRows.Should().BeGreaterThanOrEqualTo(3, "3 UserA clips were swept");

        // Per-row audit assertion (ADR-DS-009).
        var sweepAuditCount = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.audit_events " +
            "WHERE entity_type = 'VoiceClipRetained' AND action = 'RetentionSweep'");
        sweepAuditCount.Should().Be(3,
            "ADR-DS-009 §'Per-row sweep audit' — one AuditEvent per swept clip");

        // Every audit payload MUST carry UserA's CurrentTokenKid.
        var payloads = await ListStringAsync(raw,
            "SELECT payload FROM ssf.audit_events " +
            "WHERE entity_type = 'VoiceClipRetained' AND action = 'RetentionSweep'");
        payloads.Should().HaveCount(3);
        foreach (var p in payloads)
        {
            p.Should().Contain($"\"consentTokenKid\":\"{UserAKid}\"",
                "ADR-DS-009 audit-payload kid stamp — payload MUST embed UserA's CurrentTokenKid");
        }

        // The blob-store fake must have been called for UserA but NOT UserB.
        _blobStore.DeleteCalls.Should().Contain(_userA);
        _blobStore.DeleteCalls.Should().NotContain(_userB);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private async Task SeedFixtureAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        // UserA — consent withdrawn (FullHistoryJournal=false +
        // WithdrawnAtUtc set).
        await InsertConsentStateAsync(db, _userA,
            fullHistoryJournal: false,
            withdrawnAtUtc: DateTime.UtcNow.AddHours(-2),
            kid: UserAKid);

        // UserB — consent live (FullHistoryJournal=true, never withdrawn).
        await InsertConsentStateAsync(db, _userB,
            fullHistoryJournal: true,
            withdrawnAtUtc: null,
            kid: UserBKid);

        // UserA: 3 retained clips.
        for (var i = 0; i < 3; i++)
        {
            await InsertVoiceClipRetainedAsync(db, _userA, Guid.NewGuid());
        }
        // UserB: 1 retained clip.
        await InsertVoiceClipRetainedAsync(db, _userB, Guid.NewGuid());
    }

    private static async Task InsertConsentStateAsync(
        NpgsqlConnection db,
        Guid userId,
        bool fullHistoryJournal,
        DateTime? withdrawnAtUtc,
        string kid)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.user_consent_state
                (user_id, full_history_journal, cross_farm_aggregation, research_corpus_export,
                 version, granted_at_utc, withdrawn_at_utc, current_token_kid)
            VALUES (@uid, @full, false, false, 1, NOW() - INTERVAL '1 day', @wd, @kid);
            """;
        c.Parameters.AddWithValue("uid", userId);
        c.Parameters.AddWithValue("full", fullHistoryJournal);
        c.Parameters.AddWithValue("wd", withdrawnAtUtc.HasValue ? (object)withdrawnAtUtc.Value : DBNull.Value);
        c.Parameters.AddWithValue("kid", kid);
        await c.ExecuteNonQueryAsync();
    }

    private static async Task InsertVoiceClipRetainedAsync(
        NpgsqlConnection db, Guid userId, Guid clipId)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.voice_clips_retained
                (clip_id, user_id, recorded_at_utc, s3_key, dek_id, iv_b64, auth_tag_b64,
                 duration_seconds, language, consent_audit_id, created_at_utc)
            VALUES (@cid, @uid, NOW() - INTERVAL '1 hour', @s3key, 'dek-1', 'AAAA', 'AAAA',
                    5, 'mr-IN', NULL, NOW());
            """;
        c.Parameters.AddWithValue("cid", clipId);
        c.Parameters.AddWithValue("uid", userId);
        c.Parameters.AddWithValue("s3key", $"retained/{userId:D}/{clipId:D}.bin");
        await c.ExecuteNonQueryAsync();
    }

    private static async Task<int> ScalarIntAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        var raw = await cmd.ExecuteScalarAsync();
        return Convert.ToInt32(raw);
    }

    private static async Task<string?> ScalarStringAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        var raw = await cmd.ExecuteScalarAsync();
        return raw is null or DBNull ? null : raw.ToString();
    }

    private static async Task<List<string>> ListStringAsync(
        NpgsqlConnection db, string sql)
    {
        var rows = new List<string>();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync())
        {
            rows.Add(rdr.GetString(0));
        }
        return rows;
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

/// <summary>
/// Phase 07 spine-hardening — recording fake for IRetainedBlobStore.
/// Captures per-user delete calls AND performs the matching DB row
/// delete so the worker observes the same end-state the real
/// S3RetainedBlobStore would produce (real adapter deletes rows in
/// the same call). Stateless beyond the call log; new instance per
/// test.
/// </summary>
internal sealed class RecordingRetainedBlobStore : IRetainedBlobStore
{
    private readonly IConfiguration _config;
    public List<Guid> DeleteCalls { get; } = new();

    public RecordingRetainedBlobStore(IConfiguration config)
    {
        _config = config;
    }

    public async Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
    {
        DeleteCalls.Add(userId);

        // Mirror S3RetainedBlobStore.DeleteRetainedVoiceForUserAsync's
        // contract: remove the metadata rows in addition to the S3
        // objects. We hold no S3; the DB row delete is the side-effect
        // the worker (and the integration test) care about.
        var conn = _config.GetConnectionString("ShramSafalDb_Migration")
            ?? _config.GetConnectionString("ShramSafalDb")
            ?? throw new InvalidOperationException("No ShramSafalDb connection string available.");
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync(ct);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "DELETE FROM ssf.voice_clips_retained WHERE user_id = @uid";
        cmd.Parameters.AddWithValue("uid", userId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
        => Task.FromResult(metadata.ClipId);

    public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
        => Task.FromResult<RetainedClipResult?>(null);

    public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
        Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
        => Task.FromResult<IReadOnlyList<VoiceClipRetainedListItem>>(
            Array.Empty<VoiceClipRetainedListItem>());
}
