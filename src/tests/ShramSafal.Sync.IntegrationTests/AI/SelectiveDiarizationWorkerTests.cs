// spec: SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 / Task 2.11a
//
// Integration test for SelectiveDiarizationWorker. Validates that the
// worker only diarizes ai_jobs whose linked daily_logs are in the
// Trust Ladder dispute states (Disputed / CorrectionPending), and
// leaves control rows (Verified) untouched.
//
// Shape:
//   - Postgres via Testcontainers (RequiresDocker collection mirror).
//   - Apply full migration chain.
//   - Seed 3 daily_logs each linked to its own ai_job:
//       1. log#A with VerificationEvent → Disputed (must diarize)
//       2. log#B with VerificationEvent → CorrectionPending (must diarize)
//       3. log#C with VerificationEvent → Verified (control: must NOT diarize)
//   - Seed diarization_policy row 'dispute_flagged' enabled=true,
//     max_daily_cost_inr=50.
//   - Mock the "SarvamAiProvider" HttpClient to return a canned
//     diarized_transcript array.
//   - Run worker.RunTickAsync(BatchSize=10).
//   - Assert: diarized_transcript_json populated on jobs A and B,
//     null on job C.
//   - Assert: a new AiJobAttempt was added per processed job (cost
//     line, ready for AiCostBudgetGuard rollup).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.Storage;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.AI;

[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class SelectiveDiarizationWorkerTests : IAsyncLifetime
{
#pragma warning disable CS0618
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private DiarizationHandler _sarvamHandler = default!;
    private InMemoryBlobStore _blobStore = default!;

    // Three scenarios — each daily_log links to its own ai_job.
    private readonly Guid _farmId = Guid.NewGuid();
    private readonly Guid _plotId = Guid.NewGuid();
    private readonly Guid _cropCycleId = Guid.NewGuid();
    private readonly Guid _operatorUserId = Guid.NewGuid();

    private readonly Guid _logIdDisputed = Guid.NewGuid();
    private readonly Guid _logIdCorrectionPending = Guid.NewGuid();
    private readonly Guid _logIdVerified = Guid.NewGuid();

    private readonly Guid _jobIdDisputed = Guid.NewGuid();
    private readonly Guid _jobIdCorrectionPending = Guid.NewGuid();
    private readonly Guid _jobIdVerified = Guid.NewGuid();

    private readonly string _hashDisputed =
        "1111111111111111111111111111111111111111111111111111111111111111";
    private readonly string _hashCorrectionPending =
        "2222222222222222222222222222222222222222222222222222222222222222";
    private readonly string _hashVerified =
        "3333333333333333333333333333333333333333333333333333333333333333";

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        await SeedAiJobsAsync(conn);
        await SeedDailyLogsAndVerificationsAsync(conn);
        await SeedDiarizationPolicyAsync(conn);

        _sarvamHandler = new DiarizationHandler();
        _blobStore = new InMemoryBlobStore(new[]
        {
            _hashDisputed, _hashCorrectionPending, _hashVerified
        });

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
                ["Ai:SelectiveDiarization:Enabled"] = "true",
                ["Ai:SelectiveDiarization:BatchSize"] = "10",
                ["Ai:SelectiveDiarization:TickIntervalMinutes"] = "5",
                ["Sarvam:ApiSubscriptionKey"] = "test-key",
                ["Sarvam:SttEndpoint"] = "http://fake-sarvam.invalid/speech-to-text",
                ["Sarvam:SttModel"] = "saaras:v3",
                ["Sarvam:SttLanguage"] = "mr-IN",
                ["Sarvam:SttMode"] = "codemix",
                ["Sarvam:TimeoutSeconds"] = "5",
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        services
            .AddHttpClient("SarvamAiProvider")
            .ConfigurePrimaryHttpMessageHandler(() => _sarvamHandler);

        services.AddSingleton<IRawBlobStore>(_blobStore);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task RunTickAsync_diarizes_only_dispute_flagged_logs()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<SelectiveDiarizationOptions>>();

        var worker = new SelectiveDiarizationWorker(
            scopeFactory,
            options,
            NullLogger<SelectiveDiarizationWorker>.Instance);

        var processed = await worker.RunTickAsync(batchSize: 10, ct: CancellationToken.None);
        processed.Should().Be(2,
            "two daily_logs are in dispute states (Disputed + CorrectionPending); the Verified row must not be touched");

        _sarvamHandler.CallCount.Should().Be(2,
            "Sarvam should be called exactly once per dispute-flagged row");

        _sarvamHandler.RequestsObservedWithDiarization.Should().Be(2,
            "every call must include with_diarization=true in the multipart form");

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        var disputedJson = await ScalarStringAsync(raw,
            "SELECT diarized_transcript_json::text FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdDisputed));
        disputedJson.Should().NotBeNullOrWhiteSpace();
        disputedJson.Should().Contain("speaker_label", "the diarized payload must include Sarvam's speaker labels");

        var correctionPendingJson = await ScalarStringAsync(raw,
            "SELECT diarized_transcript_json::text FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdCorrectionPending));
        correctionPendingJson.Should().NotBeNullOrWhiteSpace();

        var verifiedJson = await ScalarStringAsync(raw,
            "SELECT diarized_transcript_json::text FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdVerified));
        verifiedJson.Should().BeNull(
            "the Verified control row is NOT in a dispute state — worker must leave it untouched");

        // Each processed job should have gained one new AiJobAttempt
        // carrying the diarization cost line. Disputed seed row started
        // with 1 attempt; we expect 2 after the tick.
        var disputedAttempts = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.ai_job_attempts WHERE ai_job_id = @id",
            ("id", _jobIdDisputed));
        disputedAttempts.Should().Be(2,
            "the worker must stamp a new AiJobAttempt per Sarvam diarization call for the rollup aggregator");

        var verifiedAttempts = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.ai_job_attempts WHERE ai_job_id = @id",
            ("id", _jobIdVerified));
        verifiedAttempts.Should().Be(1,
            "untouched control row has only its original seeded attempt");
    }

    [Fact]
    public async Task RunTickAsync_aborts_when_diarization_policy_is_disabled()
    {
        await using (var raw = new NpgsqlConnection(_pg.GetConnectionString()))
        {
            await raw.OpenAsync();
            await using var cmd = raw.CreateCommand();
            cmd.CommandText = """
                UPDATE ssf.diarization_policy
                SET enabled = false, modified_at_utc = NOW()
                WHERE trigger_type = 'dispute_flagged';
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<SelectiveDiarizationOptions>>();

        var worker = new SelectiveDiarizationWorker(
            scopeFactory,
            options,
            NullLogger<SelectiveDiarizationWorker>.Instance);

        var processed = await worker.RunTickAsync(10, CancellationToken.None);
        processed.Should().Be(0, "the policy row is the master gate — disabled => no work");
        _sarvamHandler.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task Worker_short_circuits_when_disabled_via_options()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var disabledOptions = Options.Create(new SelectiveDiarizationOptions
        {
            Enabled = false,
            BatchSize = 10,
            TickIntervalMinutes = 5,
        });

        var worker = new SelectiveDiarizationWorker(
            scopeFactory,
            disabledOptions,
            NullLogger<SelectiveDiarizationWorker>.Instance);

        await worker.StartAsync(CancellationToken.None);
        await worker.StopAsync(CancellationToken.None);

        _sarvamHandler.CallCount.Should().Be(0);

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();
        var filled = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.ai_jobs WHERE diarized_transcript_json IS NOT NULL");
        filled.Should().Be(0);
    }

    // ── Seed helpers ────────────────────────────────────────────────

    private async Task SeedAiJobsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await InsertAiJobAsync(db, _jobIdDisputed, _hashDisputed, "disputed");
        await InsertAttemptAsync(db, _jobIdDisputed);

        await InsertAiJobAsync(db, _jobIdCorrectionPending, _hashCorrectionPending, "correction-pending");
        await InsertAttemptAsync(db, _jobIdCorrectionPending);

        await InsertAiJobAsync(db, _jobIdVerified, _hashVerified, "verified");
        await InsertAttemptAsync(db, _jobIdVerified);
    }

    private async Task InsertAiJobAsync(
        NpgsqlConnection db, Guid jobId, string hash, string idempotencyTag)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.ai_jobs
                (id, idempotency_key, operation_type, user_id, farm_id, status,
                 input_content_hash, raw_input_ref, normalized_result_json,
                 schema_version, created_at_utc, completed_at_utc,
                 total_attempts, modified_at_utc, transcript_schema_version,
                 transcript_codemix, transcript_provider, transcript_model_version,
                 transcribed_at_utc, source, model_version, prompt_version)
            VALUES
                (@id, @idem, 'VoiceToStructuredLog', @uid, @fid, 'Succeeded',
                 @hash, @raw, '{}'::jsonb,
                 '1.0.0', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes',
                 1, NOW(), 'v1.0',
                 'mock codemix', 'Sarvam', 'saaras:v3',
                 NOW() - INTERVAL '30 minutes', 'ai', 'saaras:v3', 'v1.0');
            """;
        c.Parameters.AddWithValue("id", jobId);
        c.Parameters.AddWithValue("idem", $"diar-test-{idempotencyTag}-{jobId:N}");
        c.Parameters.AddWithValue("uid", _operatorUserId);
        c.Parameters.AddWithValue("fid", _farmId);
        c.Parameters.AddWithValue("hash", hash);
        c.Parameters.AddWithValue("raw", $"s3://retained/{hash}.wav");
        await c.ExecuteNonQueryAsync();
    }

    private static async Task InsertAttemptAsync(NpgsqlConnection db, Guid jobId)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.ai_job_attempts
                (id, ai_job_id, attempt_number, provider, is_success,
                 failure_class, attempted_at_utc, latency_ms,
                 source, model_version, prompt_version)
            VALUES
                (@id, @jid, 1, 'Sarvam', true,
                 'None', NOW() - INTERVAL '30 minutes', 250,
                 'ai', 'saaras:v3', 'v1.0');
            """;
        c.Parameters.AddWithValue("id", Guid.NewGuid());
        c.Parameters.AddWithValue("jid", jobId);
        await c.ExecuteNonQueryAsync();
    }

    private async Task SeedDailyLogsAndVerificationsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await InsertDailyLogAsync(db, _logIdDisputed, _jobIdDisputed);
        await InsertVerificationEventAsync(db, _logIdDisputed, "Disputed", "audit reason 1");

        await InsertDailyLogAsync(db, _logIdCorrectionPending, _jobIdCorrectionPending);
        await InsertVerificationEventAsync(db, _logIdCorrectionPending, "CorrectionPending", null);

        await InsertDailyLogAsync(db, _logIdVerified, _jobIdVerified);
        await InsertVerificationEventAsync(db, _logIdVerified, "Verified", null);
    }

    private async Task InsertDailyLogAsync(NpgsqlConnection db, Guid logId, Guid sourceAiJobId)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.daily_logs
                (id, farm_id, plot_id, crop_cycle_id, operator_user_id,
                 log_date, idempotency_key, created_at_utc, modified_at_utc,
                 evidence_sources_json, source, model_version, prompt_version,
                 source_ai_job_id)
            VALUES
                (@id, @fid, @pid, @ccid, @opid,
                 CURRENT_DATE, @idem, NOW() - INTERVAL '20 minutes', NOW(),
                 '[]'::jsonb, 'ai', 'saaras:v3', 'v1.0',
                 @sjid);
            """;
        c.Parameters.AddWithValue("id", logId);
        c.Parameters.AddWithValue("fid", _farmId);
        c.Parameters.AddWithValue("pid", _plotId);
        c.Parameters.AddWithValue("ccid", _cropCycleId);
        c.Parameters.AddWithValue("opid", _operatorUserId);
        c.Parameters.AddWithValue("idem", $"daily-log-{logId:N}");
        c.Parameters.AddWithValue("sjid", sourceAiJobId);
        await c.ExecuteNonQueryAsync();
    }

    private async Task InsertVerificationEventAsync(
        NpgsqlConnection db, Guid logId, string status, string? reason)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.verification_events
                (id, daily_log_id, status, reason,
                 verified_by_user_id, occurred_at_utc)
            VALUES
                (@id, @lid, @st, @r,
                 @vid, NOW() - INTERVAL '10 minutes');
            """;
        c.Parameters.AddWithValue("id", Guid.NewGuid());
        c.Parameters.AddWithValue("lid", logId);
        c.Parameters.AddWithValue("st", status);
        c.Parameters.AddWithValue("r", (object?)reason ?? DBNull.Value);
        c.Parameters.AddWithValue("vid", _operatorUserId);
        await c.ExecuteNonQueryAsync();
    }

    private async Task SeedDiarizationPolicyAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.diarization_policy
                (id, trigger_type, enabled, max_daily_cost_inr,
                 applies_to_event_type, created_at_utc, modified_at_utc)
            VALUES
                (@id, 'dispute_flagged', true, 50.0,
                 NULL, NOW(), NOW());
            """;
        c.Parameters.AddWithValue("id", Guid.NewGuid());
        await c.ExecuteNonQueryAsync();
    }

    // ── DB helpers ──────────────────────────────────────────────────

    private static async Task<string?> ScalarStringAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        var raw = await cmd.ExecuteScalarAsync();
        return raw is null or DBNull ? null : raw.ToString();
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

        var ssfOpts = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn).Options;
        await using (var ssf = new ShramSafalDbContext(ssfOpts))
        {
            await ssf.Database.MigrateAsync();
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
    }

    /// <summary>
    /// In-test HTTP handler returning a canned diarized payload and
    /// counting how many times Sarvam was called. Also asserts that
    /// every observed multipart form carried <c>with_diarization=true</c>
    /// (the Phase 2.11a wire contract added to SarvamSttClient).
    /// </summary>
    private sealed class DiarizationHandler : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public int RequestsObservedWithDiarization { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;

            // Read the multipart body so we can confirm the worker
            // toggled the diarization flag. We do NOT parse the full
            // multipart envelope — a substring check on the form-data
            // boundaries is enough for the assertion.
            if (request.Content is not null)
            {
                var body = await request.Content.ReadAsStringAsync(cancellationToken);
                if (body.Contains("with_diarization", StringComparison.Ordinal)
                    && body.Contains("true", StringComparison.Ordinal))
                {
                    RequestsObservedWithDiarization++;
                }
            }

            var payload = JsonSerializer.Serialize(new
            {
                transcript = "mock-codemix",
                language_code = "mr-IN",
                diarized_transcript = new[]
                {
                    new { speaker_label = "A", start_ms = 0, end_ms = 1500, text = "पाणी दिलं" },
                    new { speaker_label = "B", start_ms = 1700, end_ms = 3200, text = "किती लिटर?" },
                },
            });

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
        }
    }

    private sealed class InMemoryBlobStore : IRawBlobStore
    {
        private readonly HashSet<string> _knownHashes;

        public InMemoryBlobStore(IEnumerable<string> hashes)
        {
            _knownHashes = hashes.ToHashSet(StringComparer.Ordinal);
        }

        public Task<Stream> GetAsync(string sha256, CancellationToken ct)
        {
            if (!_knownHashes.Contains(sha256))
            {
                return Task.FromResult<Stream>(Stream.Null);
            }

            var buffer = new byte[256];
            for (var i = 0; i < buffer.Length; i++) buffer[i] = (byte)(i & 0xff);
            return Task.FromResult<Stream>(new MemoryStream(buffer, writable: false));
        }

        public Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task DereferenceAsync(string sha256, CancellationToken ct) =>
            Task.CompletedTask;
    }
}
