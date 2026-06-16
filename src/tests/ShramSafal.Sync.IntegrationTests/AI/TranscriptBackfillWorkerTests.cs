// spec: SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 / Task 1.10
//
// Integration test for TranscriptBackfillWorker. Validates the
// one-time backfill that copies the legacy
// normalized_result_json.fullTranscript value into the dedicated
// transcript_codemix column on ssf.ai_jobs.
//
// Test shape:
//   - Spin up Postgres via Testcontainers (RequiresDocker collection
//     to match the established pattern; CI runs the Docker-gated suite).
//   - Apply the full migration chain so ssf.ai_jobs carries every
//     column (including the Phase 1.1 transcript_* additions).
//   - Seed 5 ai_jobs rows: 3 with status=Succeeded + fullTranscript
//     present (must backfill), 1 with status=Succeeded but NO
//     fullTranscript key (must skip), 1 with status=Failed
//     (must skip — predicate filters status=Succeeded only).
//   - Call worker.RunBatchAsync directly (BatchSize large enough to
//     absorb the whole candidate set in one pass). The worker's
//     ExecuteAsync wrapper is exercised separately via the
//     options.Enabled=false short-circuit check.
//   - Assert:
//       * The 3 expected rows have transcript_codemix populated with
//         the legacy value.
//       * transcript_provider = "Gemini" on all 3.
//       * transcript_model_version = the per-row attempt model
//         (or the fallback constant when no attempt was recorded).
//       * transcribed_at_utc = the original completed_at_utc (NOT the
//         worker's clock, per the comment in
//         TranscriptBackfillWorker.RunBatchAsync).
//       * The skip-row (no fullTranscript) remains unchanged.
//       * The status=Failed row remains unchanged.
//
// Why an integration test (vs domain unit test):
//   - The worker touches EF + jsonb + the AiJob aggregate's
//     ModifiedAtUtc stamp via SaveChangesAsync — exercising the real
//     ShramSafalDbContext is the only way to catch a column-mapping
//     regression at the EF↔Postgres seam.

using System;
using System.Collections.Generic;
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
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.AI;

[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class TranscriptBackfillWorkerTests : IAsyncLifetime
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

    // Three rows that MUST be backfilled (Succeeded + fullTranscript
    // present). Each carries a distinct transcript so the assertion
    // catches a row-id ↔ value mismatch.
    private readonly Guid _jobIdWithTranscriptA = Guid.NewGuid();
    private readonly Guid _jobIdWithTranscriptB = Guid.NewGuid();
    private readonly Guid _jobIdWithTranscriptC = Guid.NewGuid();

    // Succeeded but no fullTranscript field — worker must skip
    // (transcript_codemix stays null).
    private readonly Guid _jobIdSucceededNoFullTranscript = Guid.NewGuid();

    // Failed job — worker must skip (status predicate excludes it).
    private readonly Guid _jobIdFailedWithFullTranscript = Guid.NewGuid();

    private static readonly DateTime CompletionA = new(2026, 04, 01, 09, 30, 00, DateTimeKind.Utc);
    private static readonly DateTime CompletionB = new(2026, 04, 02, 11, 15, 00, DateTimeKind.Utc);
    private static readonly DateTime CompletionC = new(2026, 04, 03, 14, 45, 00, DateTimeKind.Utc);

    private const string TranscriptA = "आज पाणी दिलं grapes plot वर.";
    private const string TranscriptB = "labour 5 जणं sugarcane तोडणी.";
    private const string TranscriptC = "spray केली pomegranate ला सकाळी.";

    private const string AttemptModelA = "gemini-2.0-flash";
    private const string AttemptModelB = "gemini-2.5-flash";
    // Attempt C: no provenance.model_version → backfill must use the
    // worker's FallbackModelVersion constant.
    private const string FallbackModelVersion = "gemini-2.5-flash";

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        await SeedAiJobsAsync(conn);

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
                // Task 1.10 — opt the worker in for the test run only.
                ["Ai:TranscriptBackfill:Enabled"] = "true",
                ["Ai:TranscriptBackfill:BatchSize"] = "50",
                ["Ai:TranscriptBackfill:DelayBetweenBatchesSeconds"] = "0",
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task RunBatchAsync_backfills_transcript_codemix_from_legacy_full_transcript()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<TranscriptBackfillOptions>>();

        var worker = new TranscriptBackfillWorker(
            scopeFactory,
            options,
            NullLogger<TranscriptBackfillWorker>.Instance);

        var processed = await worker.RunBatchAsync(
            batchSize: 50,
            ct: CancellationToken.None);

        processed.Should().Be(3,
            "exactly 3 seeded rows had status=Succeeded + a fullTranscript field; the worker must update all of them in one batch");

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        // Row A — full backfill assertions
        await AssertRowAsync(
            raw,
            _jobIdWithTranscriptA,
            expectedCodemix: TranscriptA,
            expectedProvider: "Gemini",
            expectedModelVersion: AttemptModelA,
            expectedTranscribedAtUtc: CompletionA);

        // Row B — different attempt model
        await AssertRowAsync(
            raw,
            _jobIdWithTranscriptB,
            expectedCodemix: TranscriptB,
            expectedProvider: "Gemini",
            expectedModelVersion: AttemptModelB,
            expectedTranscribedAtUtc: CompletionB);

        // Row C — no attempt provenance.model_version → fallback
        await AssertRowAsync(
            raw,
            _jobIdWithTranscriptC,
            expectedCodemix: TranscriptC,
            expectedProvider: "Gemini",
            expectedModelVersion: FallbackModelVersion,
            expectedTranscribedAtUtc: CompletionC);

        // Skip row — Succeeded but no fullTranscript key. Worker must
        // leave the column null because there is nothing to copy.
        var skippedCodemix = await ScalarStringAsync(raw,
            "SELECT transcript_codemix FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdSucceededNoFullTranscript));
        skippedCodemix.Should().BeNull(
            "rows that lack a fullTranscript field cannot be backfilled — worker skips them");

        var skippedProvider = await ScalarStringAsync(raw,
            "SELECT transcript_provider FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdSucceededNoFullTranscript));
        skippedProvider.Should().BeNull("provider is only stamped when transcript_codemix is also set");

        // Skip row — Failed status. Worker's WHERE clause excludes it
        // regardless of fullTranscript presence.
        var failedCodemix = await ScalarStringAsync(raw,
            "SELECT transcript_codemix FROM ssf.ai_jobs WHERE id = @id",
            ("id", _jobIdFailedWithFullTranscript));
        failedCodemix.Should().BeNull(
            "Failed rows must NEVER be backfilled — the status='Succeeded' predicate filters them out");
    }

    [Fact]
    public async Task RunBatchAsync_is_idempotent_on_repeat_call()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<TranscriptBackfillOptions>>();

        var worker = new TranscriptBackfillWorker(
            scopeFactory,
            options,
            NullLogger<TranscriptBackfillWorker>.Instance);

        // First pass — processes 3 rows.
        var firstPass = await worker.RunBatchAsync(50, CancellationToken.None);
        firstPass.Should().Be(3);

        // Second pass — the WHERE clause filters out rows where
        // transcript_codemix IS NOT NULL, so the candidate set is empty.
        var secondPass = await worker.RunBatchAsync(50, CancellationToken.None);
        secondPass.Should().Be(0,
            "the worker must be idempotent — re-running after a full backfill returns 0 rows updated");
    }

    [Fact]
    public async Task Worker_short_circuits_when_disabled_via_options()
    {
        // Build a tiny isolated provider whose Enabled=false setting
        // makes ExecuteAsync return immediately. Same scopeFactory +
        // DB so any accidental write would be visible on the database;
        // we expect ZERO mutations.
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var disabledOptions = Options.Create(new TranscriptBackfillOptions
        {
            Enabled = false,
            BatchSize = 50,
            DelayBetweenBatchesSeconds = 0,
        });

        var worker = new TranscriptBackfillWorker(
            scopeFactory,
            disabledOptions,
            NullLogger<TranscriptBackfillWorker>.Instance);

        // ExecuteAsync should return without touching the DB.
        await worker.StartAsync(CancellationToken.None);
        await worker.StopAsync(CancellationToken.None);

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        // None of the backfillable rows have been touched.
        var backfilledCount = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.ai_jobs WHERE transcript_codemix IS NOT NULL");
        backfilledCount.Should().Be(0,
            "Enabled=false MUST short-circuit ExecuteAsync before any DB write");
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private async Task AssertRowAsync(
        NpgsqlConnection raw,
        Guid jobId,
        string expectedCodemix,
        string expectedProvider,
        string expectedModelVersion,
        DateTime expectedTranscribedAtUtc)
    {
        var codemix = await ScalarStringAsync(raw,
            "SELECT transcript_codemix FROM ssf.ai_jobs WHERE id = @id",
            ("id", jobId));
        codemix.Should().Be(expectedCodemix);

        var provider = await ScalarStringAsync(raw,
            "SELECT transcript_provider FROM ssf.ai_jobs WHERE id = @id",
            ("id", jobId));
        provider.Should().Be(expectedProvider);

        var modelVersion = await ScalarStringAsync(raw,
            "SELECT transcript_model_version FROM ssf.ai_jobs WHERE id = @id",
            ("id", jobId));
        modelVersion.Should().Be(expectedModelVersion);

        var transcribedAt = await ScalarDateTimeAsync(raw,
            "SELECT transcribed_at_utc FROM ssf.ai_jobs WHERE id = @id",
            ("id", jobId));
        transcribedAt.Should().NotBeNull();
        transcribedAt!.Value.ToUniversalTime().Should().BeCloseTo(
            expectedTranscribedAtUtc.ToUniversalTime(),
            TimeSpan.FromSeconds(1),
            "transcribed_at_utc is preserved from the original CompletedAtUtc per the worker comment");
    }

    private async Task SeedAiJobsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        // ── Three backfillable rows ──────────────────────────────────
        await InsertAiJobAsync(db,
            jobId: _jobIdWithTranscriptA,
            status: "Succeeded",
            normalizedResultJson: BuildNormalizedJsonWithFullTranscript(TranscriptA),
            completedAtUtc: CompletionA,
            idempotencyKey: $"job-A-{_jobIdWithTranscriptA:N}");
        await InsertAiJobAttemptAsync(db,
            jobId: _jobIdWithTranscriptA,
            attemptNumber: 1,
            provider: "Gemini",
            modelVersion: AttemptModelA);

        await InsertAiJobAsync(db,
            jobId: _jobIdWithTranscriptB,
            status: "Succeeded",
            normalizedResultJson: BuildNormalizedJsonWithFullTranscript(TranscriptB),
            completedAtUtc: CompletionB,
            idempotencyKey: $"job-B-{_jobIdWithTranscriptB:N}");
        await InsertAiJobAttemptAsync(db,
            jobId: _jobIdWithTranscriptB,
            attemptNumber: 1,
            provider: "Gemini",
            modelVersion: AttemptModelB);

        // Row C: NO attempts at all → worker uses FallbackModelVersion.
        await InsertAiJobAsync(db,
            jobId: _jobIdWithTranscriptC,
            status: "Succeeded",
            normalizedResultJson: BuildNormalizedJsonWithFullTranscript(TranscriptC),
            completedAtUtc: CompletionC,
            idempotencyKey: $"job-C-{_jobIdWithTranscriptC:N}");

        // ── Skip row: Succeeded but no fullTranscript field ──────────
        await InsertAiJobAsync(db,
            jobId: _jobIdSucceededNoFullTranscript,
            status: "Succeeded",
            // Valid JSON object but no fullTranscript key.
            normalizedResultJson: """{"otherField":"value","actions":[]}""",
            completedAtUtc: new DateTime(2026, 04, 04, 08, 00, 00, DateTimeKind.Utc),
            idempotencyKey: $"job-skip-{_jobIdSucceededNoFullTranscript:N}");

        // ── Skip row: Failed status (predicate excludes) ─────────────
        await InsertAiJobAsync(db,
            jobId: _jobIdFailedWithFullTranscript,
            status: "Failed",
            normalizedResultJson: BuildNormalizedJsonWithFullTranscript("शुड् बी आइग्नोरेड"),
            completedAtUtc: new DateTime(2026, 04, 05, 12, 00, 00, DateTimeKind.Utc),
            idempotencyKey: $"job-failed-{_jobIdFailedWithFullTranscript:N}");
    }

    private static string BuildNormalizedJsonWithFullTranscript(string transcript) =>
        JsonSerializer.Serialize(new
        {
            fullTranscript = transcript,
            actions = Array.Empty<object>(),
        });

    private static async Task InsertAiJobAsync(
        NpgsqlConnection db,
        Guid jobId,
        string status,
        string normalizedResultJson,
        DateTime completedAtUtc,
        string idempotencyKey)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.ai_jobs
                (id, idempotency_key, operation_type, user_id, farm_id, status,
                 input_content_hash, raw_input_ref, normalized_result_json,
                 schema_version, created_at_utc, completed_at_utc,
                 total_attempts, modified_at_utc, transcript_schema_version,
                 source, model_version, prompt_version)
            VALUES
                (@id, @idem, 'VoiceParse', @uid, @fid, @status,
                 NULL, NULL, @json::jsonb,
                 '1.0.0', @completed_at - INTERVAL '5 seconds', @completed_at,
                 1, @completed_at, 'v1.0',
                 'ai', 'pre-backfill-unknown', 'pre-backfill-unknown');
            """;
        c.Parameters.AddWithValue("id", jobId);
        c.Parameters.AddWithValue("idem", idempotencyKey);
        c.Parameters.AddWithValue("uid", Guid.NewGuid());
        c.Parameters.AddWithValue("fid", Guid.NewGuid());
        c.Parameters.AddWithValue("status", status);
        c.Parameters.AddWithValue("json", normalizedResultJson);
        c.Parameters.AddWithValue("completed_at", completedAtUtc);
        await c.ExecuteNonQueryAsync();
    }

    private static async Task InsertAiJobAttemptAsync(
        NpgsqlConnection db,
        Guid jobId,
        int attemptNumber,
        string provider,
        string modelVersion)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.ai_job_attempts
                (id, ai_job_id, attempt_number, provider, is_success,
                 failure_class, attempted_at_utc, latency_ms,
                 source, model_version, prompt_version)
            VALUES
                (@id, @jid, @num, @prov, true,
                 'None', NOW(), 100,
                 'ai', @mv, 'v1.0');
            """;
        c.Parameters.AddWithValue("id", Guid.NewGuid());
        c.Parameters.AddWithValue("jid", jobId);
        c.Parameters.AddWithValue("num", attemptNumber);
        c.Parameters.AddWithValue("prov", provider);
        c.Parameters.AddWithValue("mv", modelVersion);
        await c.ExecuteNonQueryAsync();
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

    private static async Task<int> ScalarIntAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        var raw = await cmd.ExecuteScalarAsync();
        return Convert.ToInt32(raw);
    }

    private static async Task<DateTime?> ScalarDateTimeAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        var raw = await cmd.ExecuteScalarAsync();
        return raw is null or DBNull ? null : Convert.ToDateTime(raw);
    }

    // Correct 4-phase order lives in IntegrationMigrationChain; the previous inline
    // order ran the full SSF chain before analytics and failed with
    // 42P01 relation "analytics.events" does not exist.
    private static Task ApplyFullMigrationChainAsync(string conn)
        => IntegrationMigrationChain.ApplyAsync(conn);
}
