// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (erasure-audit-atomicity)
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
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
/// A <c>Failed</c> erasure request used to mean "the farmer's data is already
/// gone, and we kept no record of it."
///
/// <para>
/// <b>The defect.</b> The DPDP §12 cascade scrubs nine tables, then deletes
/// retained voice from S3, then writes the audit. No transaction wraps the
/// cascade — each anonymizer autocommits — but the audit rows only exist at the
/// final <c>SaveChangesAsync</c>. The catch around the S3 step handled exactly
/// one type, <c>NotImplementedException</c>, for a stub that had already been
/// deleted. Everything that could actually be thrown — AccessDenied,
/// throttling, a network fault, cancellation at shutdown — propagated, aborting
/// the run after the scrub and before the audit. The request was then stamped
/// <c>Failed</c>: nine tables irreversibly scrubbed, zero audit rows, and a
/// support person or auditor reading the row would truthfully but wrongly tell
/// the farmer their deletion had not gone through.
/// </para>
///
/// <para>
/// <b>What these tests hold.</b> That the record survives the failure, and that
/// the persisted state distinguishes the three real outcomes rather than
/// collapsing two of them into <c>Failed</c>.
/// </para>
///
/// <para>
/// <b>What they deliberately do NOT assert.</b> That the S3 object was deleted.
/// The fix must not make the database scrub conditional on the blob delete —
/// with the delete failing, that would mean erasure never completes at all,
/// which is strictly worse for the farmer. What became atomic is the record,
/// not the deletion. The farmer's right is unchanged.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ErasureAuditSurvivesBlobFailureRealPostgresTests : IAsyncLifetime
{
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _farmId = Guid.NewGuid();
    private readonly Guid _dailyLogId = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_erasure_audit_atomicity_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
        await SeedFixtureAsync();
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    /// <summary>
    /// THE named red→green test. The retained-voice delete throws exactly what
    /// production would throw if the bucket denied the call; the audit record
    /// must still exist afterwards.
    /// </summary>
    [Fact]
    public async Task AuditRecord_SurvivesA_RetainedVoiceDeletionFailure()
    {
        var requestId = await SeedErasureRequestAsync();

        await RunWorkerAsync(new ThrowingRetainedBlobStore(), requestId);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        // 1. The record exists at all. Before the fix this was zero.
        var auditCount = Convert.ToInt32(await ScalarAsync(raw,
            """
            SELECT count(*) FROM ssf.audit_events
             WHERE entity_type = 'ErasureRequest' AND entity_id = @id
            """,
            ("id", requestId)));

        auditCount.Should().BeGreaterThan(0,
            "the nine tables are already scrubbed and committed by the time the blob delete runs — " +
            "losing the audit means the erasure happened with no record that it happened");

        // 2. It says what actually occurred, on both halves.
        var payload = (string?)await ScalarAsync(raw,
            """
            SELECT payload::text FROM ssf.audit_events
             WHERE entity_type = 'ErasureRequest' AND entity_id = @id
             ORDER BY occurred_at_utc DESC LIMIT 1
            """,
            ("id", requestId));

        payload.Should().NotBeNull();
        payload!.Should().Contain("\"retainedVoiceDeleted\":false",
            "the record must state that the voice tier was NOT purged");
        payload.Should().Contain("\"retainedVoiceResidue\":\"AmazonS3Exception: Access Denied\"",
            "the reason must be preserved for triage, not flattened to a boolean");
        payload.Should().Contain("\"rowsAnonymizedCount\"",
            "the count of what WAS scrubbed is the honest part of the outcome");
    }

    /// <summary>
    /// The two outcomes are distinguishable in the persisted state. Before the
    /// fix, "nothing happened" and "nine tables scrubbed, blob deletion failed"
    /// both read <c>Failed</c>.
    /// </summary>
    [Fact]
    public async Task ScrubbedWithFailedBlobDelete_IsDistinguishableFrom_CleanCompletion()
    {
        var residueRequestId = await SeedErasureRequestAsync();
        await RunWorkerAsync(new ThrowingRetainedBlobStore(), residueRequestId);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var residueStatus = Convert.ToInt32(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", residueRequestId)));

        residueStatus.Should().Be((int)ErasureStatus.CompletedWithResidue,
            "scrubbed-but-residue is its own outcome; reporting it as Failed tells a support person " +
            "nothing happened when in fact the data is irreversibly gone");

        residueStatus.Should().NotBe((int)ErasureStatus.Failed);
        residueStatus.Should().NotBe((int)ErasureStatus.Completed,
            "nor may it claim a clean erasure while the farmer's raw audio still exists");

        // The count is real, not null — that is what makes it different from
        // "nothing happened".
        var rows = await ScalarAsync(raw,
            "SELECT rows_anonymized_count FROM ssf.erasure_requests WHERE id = @id",
            ("id", residueRequestId));
        Convert.ToInt32(rows).Should().BeGreaterThan(0);

        // failure_reason stays NULL: this did not fail, and overloading the
        // column would put a non-failure behind a field named for failures.
        var failureReason = await ScalarAsync(raw,
            "SELECT failure_reason FROM ssf.erasure_requests WHERE id = @id",
            ("id", residueRequestId));
        (failureReason is null or DBNull).Should().BeTrue();
    }

    /// <summary>
    /// The clean path still reports <c>Completed</c> — the new state must not
    /// swallow the old one. Without this, a fix that stamped every run
    /// "CompletedWithResidue" would pass the test above while destroying the
    /// distinction it exists to create.
    /// </summary>
    [Fact]
    public async Task CleanRun_StillReportsCompleted_AndSaysTheVoiceTierWasPurged()
    {
        var requestId = await SeedErasureRequestAsync();

        await RunWorkerAsync(new NoOpRetainedBlobStore(), requestId);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var status = Convert.ToInt32(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)));
        status.Should().Be((int)ErasureStatus.Completed);

        var payload = (string?)await ScalarAsync(raw,
            """
            SELECT payload::text FROM ssf.audit_events
             WHERE entity_type = 'ErasureRequest' AND entity_id = @id
             ORDER BY occurred_at_utc DESC LIMIT 1
            """,
            ("id", requestId));

        payload.Should().NotBeNull();
        payload!.Should().Contain("\"retainedVoiceDeleted\":true",
            "a clean run must state the voice tier WAS purged, not merely omit the field");
    }

    // ── harness ──────────────────────────────────────────────────────────

    /// <summary>
    /// Runs the worker with <paramref name="retainedStore"/> substituted for the
    /// real S3 adapter. Everything else — the admin context factory, the nine
    /// anonymizers, the audit emission — is the production wiring.
    ///
    /// <para>
    /// <b>Polls for a terminal status rather than sleeping a fixed interval.</b>
    /// The first draft slept 3 s and observed a genuine flake: these suites run
    /// in parallel and each provisions its own scratch database through the full
    /// migration chain, so the worker's first pass does not reliably finish
    /// inside a fixed window. A privacy invariant must not be guarded by a test
    /// that fails on machine load — and, worse, a timing flake here is
    /// indistinguishable from the real defect, because both present as "no audit
    /// row yet". Polling removes that ambiguity: if the status never becomes
    /// terminal we fail with a message that says so explicitly.
    /// </para>
    /// </summary>
    private async Task RunWorkerAsync(IRetainedBlobStore retainedStore, Guid requestId)
    {
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
        services.AddSingleton(retainedStore);

        await using var provider = services.BuildServiceProvider();

        var scopeFactory = provider.GetRequiredService<IServiceScopeFactory>();
        var worker = new ErasureWorker(scopeFactory, NullLogger<ErasureWorker>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var workerTask = worker.StartAsync(cts.Token);

        var deadline = DateTime.UtcNow.AddSeconds(45);
        int? status = null;

        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(250), CancellationToken.None);

            await using var probe = new NpgsqlConnection(_superuserConn);
            await probe.OpenAsync();
            var raw = await ScalarAsync(probe,
                "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId));

            if (raw is not null)
            {
                status = Convert.ToInt32(raw);
                if (status is (int)ErasureStatus.Completed
                            or (int)ErasureStatus.CompletedWithResidue
                            or (int)ErasureStatus.Failed)
                {
                    break;
                }
            }
        }

        await cts.CancelAsync();
        try { await workerTask; } catch (OperationCanceledException) { }

        status.Should().NotBeNull("the erasure request row must exist");
        status.Should().BeOneOf(
            [(int)ErasureStatus.Completed, (int)ErasureStatus.CompletedWithResidue, (int)ErasureStatus.Failed],
            "the worker must reach a terminal status within the deadline — a request still sitting at " +
            "Requested/InProgress means the pass never ran, and every assertion after this point would " +
            "be measuring the harness rather than the behaviour under test");
    }

    /// <summary>
    /// Fails the way production would if the bucket refused the call. The
    /// erasure path must survive this, not abort on it.
    /// </summary>
    private sealed class ThrowingRetainedBlobStore : IRetainedBlobStore
    {
        public Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct) =>
            throw new Amazon.S3.AmazonS3Exception("Access Denied")
            {
                ErrorCode = "AccessDenied",
                StatusCode = System.Net.HttpStatusCode.Forbidden,
            };

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    /// <summary>Succeeds silently — the clean-path control.</summary>
    private sealed class NoOpRetainedBlobStore : IRetainedBlobStore
    {
        public Task DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct) => Task.CompletedTask;

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    private async Task<Guid> SeedErasureRequestAsync()
    {
        var requestId = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.erasure_requests
                (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
            VALUES (@id, @uid, NULL, 0, NOW());
            """;
        cmd.Parameters.AddWithValue("id", requestId);
        cmd.Parameters.AddWithValue("uid", _userId);
        await cmd.ExecuteNonQueryAsync();
        return requestId;
    }

    /// <summary>
    /// Enough real data for the cascade to scrub something — a non-zero count is
    /// what makes "CompletedWithResidue" mean more than "Failed".
    /// </summary>
    private async Task SeedFixtureAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Erasure Audit Atomicity Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", _farmId);
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", _dailyLogId);
            c.Parameters.AddWithValue("fid", _farmId);
            c.Parameters.AddWithValue("pid", Guid.NewGuid());
            c.Parameters.AddWithValue("cid", Guid.NewGuid());
            c.Parameters.AddWithValue("uid", _userId);
            await c.ExecuteNonQueryAsync();
        }
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in parameters)
        {
            cmd.Parameters.AddWithValue(n, v);
        }

        var result = await cmd.ExecuteScalarAsync();
        return result is DBNull ? null : result;
    }
}
