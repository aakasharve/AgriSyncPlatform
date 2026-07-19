// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// 2026-07-19 (founder Decision 5, spec 2026-07-13-labour-attendance-approval-design)
/// — a <c>RequiresPostgres</c>-category, Docker-free twin of the worker-name
/// slice of <see cref="ErasureWorkerAnonymizationTest"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists alongside the Docker-gated test.</b>
/// <see cref="ErasureWorkerAnonymizationTest"/> carries
/// <c>[Trait("Category","RequiresDocker")]</c>, and — per the same
/// 2026-07-19 correction recorded on <c>WorkerNameProjectorActivationTests</c>
/// — no workflow under <c>.github/workflows/</c> runs that category. An
/// erasure test that never executes anywhere proves nothing, no matter how
/// thorough its assertions are; that is precisely the "false coverage claim"
/// this branch's own Blocker 4 fix already corrected for the money-invariant
/// tests (see <c>LabourMoneyInvariantsRealPostgresTests</c>). This class
/// applies the identical fix to the erasure test: same seed shape, same
/// assertions, but run against native Postgres (<c>RequiresPostgresConnection</c>,
/// a fresh scratch database per test via <c>IntegrationMigrationChain</c>) —
/// which DOES run in CI and is reachable on this machine (:5433) with no
/// Docker at all. This is the suite that was actually executed locally to
/// produce the before/after failure proof recorded in
/// <c>.superpowers/sdd/phase5-privacy-report.md</c>.
/// </para>
/// <para>
/// <b>Scope.</b> Deliberately narrower than the Docker-gated sibling — this
/// proves only the NEW worker-name erasure disposition (Decision 5 items 3+4):
/// <c>ssf.workers</c> name scrub, <c>ssf.worker_assignments</c> survives
/// unorphaned, <c>ssf.labour_assignments.worker_names_json</c> scrub. It does
/// not re-prove the pre-existing DS-017 5-rule contract (daily_logs,
/// cost_entries, etc.) — that coverage already exists elsewhere; duplicating
/// it here would violate this repo's own KISS/DRY/YAGNI rule for no added
/// signal.
/// </para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerWorkerNameScrubRealPostgresTests : IAsyncLifetime
{
    private const string WorkerRawName = "Sunil WorkerPiiName";
    private const string WorkerNormalizedName = "sunil workerpiiname";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider _provider = default!;

    private Guid _farmId;
    private Guid _userId;
    private Guid _plotId;
    private Guid _cycleId;
    private Guid _dailyLogId;
    private Guid _workerId;

    public async Task InitializeAsync()
    {
        // Throws (does not skip) if Postgres is unconfigured/unreachable —
        // same CI-truthfulness contract as every other RequiresPostgres suite.
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_erasure_workername_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _farmId = Guid.NewGuid();
        _userId = Guid.NewGuid();
        _plotId = Guid.NewGuid();
        _cycleId = Guid.NewGuid();
        _dailyLogId = Guid.NewGuid();
        _workerId = Guid.NewGuid();

        await SeedFixtureAsync();

        // Single connection string for everything — same "plain read-model
        // proof, not an RLS boundary test" framing as LabourMoneyInvariantsRealPostgresTests.
        // ErasureWorker resolves its admin-elevated context via
        // ShramSafalDb_Migration (falling back to ShramSafalDb); pointing
        // both at the same scratch-DB connection is sufficient here.
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        // Voice Diary ship's InMemoryRetainedBlobStore fake (defined in the
        // Docker-gated sibling test, same assembly/namespace) — the fixture
        // seeds no voice_clips_retained rows, so this is a no-op registration
        // that only satisfies ErasureWorker's IRetainedBlobStore dependency.
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();

        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

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

    [Fact]
    public async Task ErasureWorker_scrubs_third_party_worker_names_derived_from_the_erased_users_own_logs()
    {
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
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

        var scopeFactory = _provider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var workerTask = worker.StartAsync(cts.Token);
        await Task.Delay(TimeSpan.FromSeconds(3), CancellationToken.None);
        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var status = (int)(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))!;
        status.Should().Be((int)ErasureStatus.Completed,
            "ErasureWorker must transition the request to Completed within one pass");

        // ── ssf.workers: ANONYMIZE, not KEEP ────────────────────────────
        var nameRaw = (string)(await ScalarAsync(raw,
            "SELECT name_raw FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        nameRaw.Should().NotBe(WorkerRawName, "ssf.workers.name_raw must be scrubbed, not survive verbatim");
        nameRaw.Should().NotContain("Sunil");

        var nameNormalized = (string)(await ScalarAsync(raw,
            "SELECT name_normalized FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        nameNormalized.Should().NotContain("sunil");

        var farmId = (Guid)(await ScalarAsync(raw,
            "SELECT farm_id FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        farmId.Should().Be(_farmId, "farm_id is a KEEP field");

        var assignmentCount = (int)(await ScalarAsync(raw,
            "SELECT assignment_count FROM ssf.workers WHERE \"Id\" = @wid", ("wid", _workerId)))!;
        assignmentCount.Should().Be(1, "assignment_count is a KEEP field");

        // ── ssf.worker_assignments: KEEP, not orphaned ──────────────────
        var assignmentsCount = Convert.ToInt32((await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.worker_assignments WHERE worker_id = @wid AND daily_log_id = @dlid",
            ("wid", _workerId), ("dlid", _dailyLogId)))!);
        assignmentsCount.Should().Be(1,
            "the link row must survive the ssf.workers scrub unorphaned — sentinel-replace, not hard-delete");

        // ── ssf.labour_assignments.worker_names_json: ANONYMIZE (partial) ─
        var workerNamesJson = (string)(await ScalarAsync(raw,
            "SELECT worker_names_json::text FROM ssf.labour_assignments WHERE daily_log_id = @dlid",
            ("dlid", _dailyLogId)))!;
        workerNamesJson.Should().NotContain(WorkerRawName);
        workerNamesJson.Should().Be("[]", "worker_names_json resets to the empty-array default, not partial scrubbing");

        // ── KEEP: the rest of the labour_assignments row is untouched ────
        var workerCount = (int)(await ScalarAsync(raw,
            "SELECT worker_count FROM ssf.labour_assignments WHERE daily_log_id = @dlid", ("dlid", _dailyLogId)))!;
        workerCount.Should().Be(4, "engagement facts (worker_count etc.) remain de-identified KEEP fields, unaffected by the name scrub");
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters) cmd.Parameters.AddWithValue(n, v);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task SeedFixtureAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Erasure Worker-Name Proof Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", _dailyLogId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", _plotId);
            c.Parameters.AddWithValue("cid", _cycleId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc)
                VALUES
                    (@id, @dlid, 'Hired', 4, 50, NULL, @names::jsonb, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            c.Parameters.AddWithValue("names", $"[\"{WorkerRawName}\"]");
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.workers
                    ("Id", farm_id, name_raw, name_normalized, first_seen_utc, assignment_count)
                VALUES
                    (@id, @fid, @raw, @norm, NOW(), 1);
                """;
            c.Parameters.AddWithValue("id", _workerId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("raw", WorkerRawName);
            c.Parameters.AddWithValue("norm", WorkerNormalizedName);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.worker_assignments
                    ("Id", worker_id, daily_log_id, confidence, occurred_at_utc)
                VALUES
                    (@id, @wid, @dlid, 0.85, NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("wid", _workerId);
            c.Parameters.AddWithValue("dlid", _dailyLogId);
            await c.ExecuteNonQueryAsync();
        }
    }
}
