// spec: SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 / Task 2.11
//
// Integration test for VerbatimSamplingWorker. Validates the three-gate
// design (Options.Enabled / feature_flags / mode_policy daily cap)
// + per-row gates (hash-bucket sampling, consent enforcement).
//
// Shape:
//   - Postgres via Testcontainers (RequiresDocker collection mirror).
//   - Apply full migration chain so ssf.ai_jobs / feature_flags /
//     mode_policy / user_consent_state all exist.
//   - Seed 20 ai_jobs rows with diverse audio_content_hash values +
//     Sarvam provider + Succeeded status (per envelope §Task 2.11):
//       * Half (10 rows) have a UserConsentState row with
//         VerbatimTrainingCorpus = true; the other half do NOT.
//       * Hashes are chosen so a deterministic subset lands in the
//         10% sampling bucket — the test forces 4 specific rows into
//         the bucket via crafted hex prefixes (00, 0a, 14, 1e =
//         leading_int mod 100 ∈ {0, 10, 20, 30}; only 0 falls under
//         the 10% threshold).
//   - Mock the "SarvamAiProvider" HttpClient with a fake handler that
//     returns a canned transcript and counts calls per audio_content_hash.
//   - Seed feature_flags row 'verbatim_corpus_sampling_enabled' = true
//     and mode_policy row 'verbatim_sample' with maxDailyCostInr = 100.
//   - Run worker.RunTickAsync(BatchSize=20).
//   - Assert: exactly the rows that satisfy ALL of (Sarvam +
//     Succeeded + hash in bucket + consent granted) get
//     transcript_verbatim populated. Expect ~1 row by design.
//   - Assert: mock Sarvam handler called the expected number of times.
//   - Assert: a SECOND tick is idempotent (returns 0 — rows already
//     filled fall out of the candidate set).

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
public sealed class VerbatimSamplingWorkerTests : IAsyncLifetime
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
    private CountingHandler _sarvamHandler = default!;
    private CapturingRawBlobStore _blobStore = default!;

    // Hash-bucket math: leading 8 hex chars parsed as Int32, Abs, mod 100,
    // compared against SamplingRatePercent (default 10).
    //   "00000000..." → 0       → 0  mod 100 = 0   → IN  bucket (<10)
    //   "0000000a..." → 10      → 10 mod 100 = 10  → OUT bucket (≥10)
    //   "00000014..." → 20      → 20 mod 100 = 20  → OUT bucket
    //   "0000001e..." → 30      → 30 mod 100 = 30  → OUT bucket
    // We give 10 users (UserA..UserJ) where:
    //   * A,B,C,D,E (5 users) have consent granted
    //   * F,G,H,I,J (5 users) have consent denied (no row)
    // Each user owns 2 jobs:
    //   * job#1 has hash starting "00000000" → IN bucket
    //   * job#2 has hash starting "00000014" → OUT bucket
    // Expected: only consented users with in-bucket jobs get verbatim.
    //   Users A..E × in-bucket job#1 = 5 rows expected to be sampled.
    private readonly List<(Guid UserId, Guid JobId, string Hash, bool Consented, bool InBucket)> _seed = new();

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        SeedPlan();
        await SeedAiJobsAsync(conn);
        await SeedFeatureFlagAndPolicyAsync(conn);
        await SeedUserConsentRowsAsync(conn);

        _sarvamHandler = new CountingHandler();
        _blobStore = new CapturingRawBlobStore(_seed);

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
                // Opt the worker in for the test run only.
                ["Ai:VerbatimSampling:Enabled"] = "true",
                ["Ai:VerbatimSampling:BatchSize"] = "20",
                ["Ai:VerbatimSampling:TickIntervalMinutes"] = "60",
                ["Ai:VerbatimSampling:SamplingRatePercent"] = "10",
                // SarvamOptions: the worker forwards an empty languageHint
                // and lets the client fall back to SttLanguage. Seed a
                // value so the fallback path is exercised.
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

        // Override the "SarvamAiProvider" named client to route every
        // call through our counting handler. The handler emits a canned
        // verbatim transcript per hash so each successful call returns
        // a unique string we can assert on.
        services
            .AddHttpClient("SarvamAiProvider")
            .ConfigurePrimaryHttpMessageHandler(() => _sarvamHandler);

        // Replace the in-memory raw blob store with one whose contents
        // we control: the worker must call IRawBlobStore.GetAsync(hash)
        // and we return a non-empty audio buffer keyed on hash. Real
        // S3 / file IO is not in scope here.
        services.AddSingleton<IRawBlobStore>(_blobStore);

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task RunTickAsync_samples_only_in_bucket_consented_rows()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<VerbatimSamplingOptions>>();

        var worker = new VerbatimSamplingWorker(
            scopeFactory,
            options,
            NullLogger<VerbatimSamplingWorker>.Instance);

        var processed = await worker.RunTickAsync(batchSize: 20, ct: CancellationToken.None);

        // Expected sample set: consented × in-bucket rows only.
        // Per SeedPlan(): 5 consented users (A..E) × 1 in-bucket job each = 5.
        var expectedSampled = _seed
            .Where(s => s.Consented && s.InBucket)
            .ToList();

        processed.Should().Be(expectedSampled.Count,
            "the worker must update exactly the consented × in-bucket subset");

        _sarvamHandler.CallCount.Should().Be(expectedSampled.Count,
            "Sarvam should be called once per consented in-bucket row");

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();

        foreach (var (_, jobId, hash, consented, inBucket) in _seed)
        {
            var verbatim = await ScalarStringAsync(raw,
                "SELECT transcript_verbatim FROM ssf.ai_jobs WHERE id = @id",
                ("id", jobId));

            if (consented && inBucket)
            {
                verbatim.Should().NotBeNullOrWhiteSpace(
                    $"job {jobId} (consented + in-bucket, hash={hash}) must have a verbatim transcript");
                verbatim.Should().StartWith("verbatim::",
                    "the fake Sarvam handler stamps a known prefix on every successful transcript");
            }
            else
            {
                verbatim.Should().BeNull(
                    $"job {jobId} (consented={consented}, inBucket={inBucket}, hash={hash}) must remain untouched");
            }
        }
    }

    [Fact]
    public async Task RunTickAsync_is_idempotent_on_repeat_call()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<VerbatimSamplingOptions>>();

        var worker = new VerbatimSamplingWorker(
            scopeFactory,
            options,
            NullLogger<VerbatimSamplingWorker>.Instance);

        // First pass — processes the consented × in-bucket subset.
        var firstPass = await worker.RunTickAsync(20, CancellationToken.None);
        var expectedFirst = _seed.Count(s => s.Consented && s.InBucket);
        firstPass.Should().Be(expectedFirst);

        var callCountAfterFirstPass = _sarvamHandler.CallCount;

        // Second pass — every newly-filled transcript_verbatim now fails
        // the IS NULL predicate so the candidate set is empty.
        var secondPass = await worker.RunTickAsync(20, CancellationToken.None);
        secondPass.Should().Be(0,
            "worker is idempotent — rows with non-null transcript_verbatim fall out of the candidate set");

        _sarvamHandler.CallCount.Should().Be(callCountAfterFirstPass,
            "no new Sarvam calls should fire on the second tick");
    }

    [Fact]
    public async Task RunTickAsync_aborts_when_cohort_flag_is_disabled()
    {
        // Flip the feature flag off and re-run; the worker must no-op
        // even when every other gate is open. Direct UPDATE because the
        // worker reads the row from the DbContext, not from an in-memory
        // cache.
        await using (var raw = new NpgsqlConnection(_pg.GetConnectionString()))
        {
            await raw.OpenAsync();
            await using var cmd = raw.CreateCommand();
            cmd.CommandText = """
                UPDATE ssf.feature_flags
                SET enabled = false, modified_at_utc = NOW()
                WHERE flag_name = 'verbatim_corpus_sampling_enabled';
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var options = _rootProvider.GetRequiredService<IOptions<VerbatimSamplingOptions>>();

        var worker = new VerbatimSamplingWorker(
            scopeFactory,
            options,
            NullLogger<VerbatimSamplingWorker>.Instance);

        var processed = await worker.RunTickAsync(20, CancellationToken.None);
        processed.Should().Be(0, "the cohort flag is the master gate — disabled => no work, no Sarvam calls");
        _sarvamHandler.CallCount.Should().Be(0);
    }

    [Fact]
    public async Task Worker_short_circuits_when_disabled_via_options()
    {
        var scopeFactory = _rootProvider.GetRequiredService<IServiceScopeFactory>();
        var disabledOptions = Options.Create(new VerbatimSamplingOptions
        {
            Enabled = false,
            BatchSize = 20,
            TickIntervalMinutes = 60,
            SamplingRatePercent = 10,
        });

        var worker = new VerbatimSamplingWorker(
            scopeFactory,
            disabledOptions,
            NullLogger<VerbatimSamplingWorker>.Instance);

        await worker.StartAsync(CancellationToken.None);
        await worker.StopAsync(CancellationToken.None);

        _sarvamHandler.CallCount.Should().Be(0,
            "Enabled=false MUST short-circuit ExecuteAsync before any Sarvam call");

        await using var raw = new NpgsqlConnection(_pg.GetConnectionString());
        await raw.OpenAsync();
        var filled = await ScalarIntAsync(raw,
            "SELECT count(*) FROM ssf.ai_jobs WHERE transcript_verbatim IS NOT NULL");
        filled.Should().Be(0);
    }

    [Theory]
    [InlineData("00000000abcdef01", true)]   // 0 mod 100 = 0 → in 10% bucket
    [InlineData("00000005abcdef01", true)]   // 5 mod 100 = 5 → in 10% bucket
    [InlineData("00000009abcdef01", true)]   // 9 mod 100 = 9 → in 10% bucket
    [InlineData("0000000aabcdef01", false)]  // 10 mod 100 = 10 → NOT in 10% bucket
    [InlineData("0000001eabcdef01", false)]  // 30 mod 100 = 30 → NOT in 10% bucket
    [InlineData("00000063abcdef01", false)]  // 99 mod 100 = 99 → NOT in 10% bucket
    public void FallsInSamplingBucket_at_10pct_matches_documented_buckets(string hash, bool expected)
    {
        VerbatimSamplingWorker.FallsInSamplingBucket(hash, 10).Should().Be(expected);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private void SeedPlan()
    {
        // 10 users. 5 consented, 5 not. Each owns 2 jobs:
        //   job#1 → hash leading bytes "00000000" (in 10% bucket)
        //   job#2 → hash leading bytes "00000014" (NOT in 10% bucket)
        // The leading 8 hex chars uniquely determine bucket membership;
        // the remaining 56 hex chars are random per row so each ai_jobs
        // row has a distinct InputContentHash (the unique-ish identifier
        // used by IRawBlobStore.GetAsync).
        var rng = new Random(42); // deterministic
        for (var i = 0; i < 10; i++)
        {
            var userId = Guid.NewGuid();
            var consented = i < 5;

            var hashIn = "00000000" + RandomHex(56, rng);
            var hashOut = "00000014" + RandomHex(56, rng);

            _seed.Add((userId, Guid.NewGuid(), hashIn, consented, InBucket: true));
            _seed.Add((userId, Guid.NewGuid(), hashOut, consented, InBucket: false));
        }
    }

    private static string RandomHex(int length, Random rng)
    {
        var sb = new StringBuilder(length);
        for (var i = 0; i < length; i++)
        {
            sb.Append("0123456789abcdef"[rng.Next(16)]);
        }
        return sb.ToString();
    }

    private async Task SeedAiJobsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        foreach (var (userId, jobId, hash, _, _) in _seed)
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
            c.Parameters.AddWithValue("idem", $"verbatim-test-{jobId:N}");
            c.Parameters.AddWithValue("uid", userId);
            c.Parameters.AddWithValue("fid", Guid.NewGuid());
            c.Parameters.AddWithValue("hash", hash);
            c.Parameters.AddWithValue("raw", $"s3://retained/{hash}.wav");
            await c.ExecuteNonQueryAsync();
        }
    }

    private async Task SeedFeatureFlagAndPolicyAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.feature_flags
                    (id, flag_name, enabled, cohort_pattern, description,
                     modified_at_utc, modified_by)
                VALUES
                    (@id, 'verbatim_corpus_sampling_enabled', true, 'all',
                     'enabled for VerbatimSamplingWorkerTests',
                     NOW(), 'test-seed');
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.mode_policy
                    (id, trigger_type, modes_to_run, priority,
                     max_daily_cost_inr, applies_to_event_type, enabled,
                     created_at_utc, modified_at_utc)
                VALUES
                    (@id, 'verbatim_sample', 'verbatim', 10,
                     100.0, NULL, true,
                     NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            await c.ExecuteNonQueryAsync();
        }
    }

    private async Task SeedUserConsentRowsAsync(string conn)
    {
        await using var db = new NpgsqlConnection(conn);
        await db.OpenAsync();

        foreach (var userId in _seed
            .Where(s => s.Consented)
            .Select(s => s.UserId)
            .Distinct())
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.user_consent_state
                    (user_id, full_history_journal, cross_farm_aggregation,
                     research_corpus_export, verbatim_training_corpus,
                     english_translation_for_admin, version,
                     granted_at_utc, withdrawn_at_utc, current_token_kid)
                VALUES
                    (@uid, true, false, false, true, true, 1,
                     NOW(), NULL, NULL);
                """;
            c.Parameters.AddWithValue("uid", userId);
            await c.ExecuteNonQueryAsync();
        }
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
        NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var raw = await cmd.ExecuteScalarAsync();
        return Convert.ToInt32(raw);
    }

    // Correct 4-phase order lives in IntegrationMigrationChain; the previous inline
    // order ran the full SSF chain before analytics and failed with
    // 42P01 relation "analytics.events" does not exist.
    private static Task ApplyFullMigrationChainAsync(string conn)
        => IntegrationMigrationChain.ApplyAsync(conn);

    /// <summary>
    /// In-test HTTP handler intercepting "SarvamAiProvider" calls. Returns
    /// a canned transcript per request and counts total invocations. The
    /// transcript is stamped with the audio_content_hash that the worker
    /// passed in the multipart form so the test can correlate Sarvam
    /// outputs to seeded jobs.
    /// </summary>
    private sealed class CountingHandler : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;

            // The SarvamVerbatimSttClient does NOT send the content hash
            // in the multipart form (it's computed locally for idempotency
            // lookup). So our canned transcript is a generic value with a
            // known prefix the assertion checks for.
            var payload = JsonSerializer.Serialize(new
            {
                transcript = "verbatim::" + Guid.NewGuid().ToString("N")[..8],
                language_code = "mr-IN",
            });

            await Task.CompletedTask; // suppress CS1998
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };
        }
    }

    /// <summary>
    /// In-memory IRawBlobStore that returns a non-empty audio buffer for
    /// any hash present in the seed plan. Unknown hashes return null so
    /// the worker logs Debug + skips. Captures every requested hash for
    /// optional assertions; this test asserts on the DB state rather
    /// than the access pattern so the capture is informational only.
    /// </summary>
    private sealed class CapturingRawBlobStore : IRawBlobStore
    {
        private readonly HashSet<string> _knownHashes;
        public List<string> RequestedHashes { get; } = new();

        public CapturingRawBlobStore(
            IEnumerable<(Guid UserId, Guid JobId, string Hash, bool Consented, bool InBucket)> seed)
        {
            _knownHashes = seed.Select(s => s.Hash).ToHashSet(StringComparer.Ordinal);
        }

        public Task<Stream> GetAsync(string sha256, CancellationToken ct)
        {
            RequestedHashes.Add(sha256);
            if (!_knownHashes.Contains(sha256))
            {
                return Task.FromResult<Stream>(Stream.Null);
            }

            // Real WAV would be larger; the byte length is incidental
            // to the worker (it forwards the stream to Sarvam). A
            // 256-byte buffer is enough to defeat the empty-payload guard
            // inside SarvamVerbatimSttClient.
            var buffer = new byte[256];
            for (var i = 0; i < buffer.Length; i++) buffer[i] = (byte)(i & 0xff);
            return Task.FromResult<Stream>(new MemoryStream(buffer, writable: false));
        }

        public Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct) =>
            throw new NotSupportedException("Verbatim worker test does not call PutAsync.");

        public Task DereferenceAsync(string sha256, CancellationToken ct) =>
            Task.CompletedTask;
    }
}
