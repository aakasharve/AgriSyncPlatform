// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (erasure-audit-atomicity)
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using ShramSafal.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Persistence;
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

    /// <summary>
    /// The kill-switch must NOT be recorded as a successful purge.
    ///
    /// <para>
    /// <c>aws/voice-retained/README.md:148</c> offers, as a supported "safer
    /// alternative", blanking <c>RetainedBlobStore__BucketName</c> and
    /// redeploying — explicitly stating "clips remain in S3 untouched". Do that
    /// after clips exist and the next erasure takes the store's no-bucket
    /// short-circuit: it touches no S3 object, leaves the
    /// <c>voice_clips_retained</c> rows where they are, and returns without
    /// throwing. Returning quietly is the hazard — to a caller that reads only
    /// "did it throw", a skip is indistinguishable from a purge.
    /// </para>
    ///
    /// <para>
    /// The first version of this task's payload reported that as
    /// <c>retainedVoiceDeleted: true</c> with status <c>Completed</c> — the
    /// farmer's audio still in the bucket, the rows that located it gone, and
    /// the record now affirming the tier was purged. That is worse than the
    /// silence it replaced: it converted an omission into a false affirmative,
    /// on the erasure path.
    /// </para>
    ///
    /// <para>
    /// This is not speculative residue. <c>PersistAsync</c> throws when the
    /// bucket name is blank, so a metadata row can only exist if a bucket was
    /// configured when the clip was stored — meaning the object was written and
    /// is still there.
    /// </para>
    /// </summary>
    [Fact]
    public async Task NoBucketConfiguredSkip_IsRecordedAsResidue_NotAsAPurge()
    {
        var requestId = await SeedErasureRequestAsync();

        await RunWorkerAsync(new SkippingRetainedBlobStore(), requestId);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var status = Convert.ToInt32(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)));
        status.Should().Be((int)ErasureStatus.CompletedWithResidue,
            "a skip that deleted neither the object nor the row pointing at it is residue, not success");

        var payload = (string?)await ScalarAsync(raw,
            """
            SELECT payload::text FROM ssf.audit_events
             WHERE entity_type = 'ErasureRequest' AND entity_id = @id
             ORDER BY occurred_at_utc DESC LIMIT 1
            """,
            ("id", requestId));

        payload.Should().NotBeNull();
        payload!.Should().Contain("\"retainedVoiceDeleted\":false",
            "the record must not affirm a purge that did not happen");
        payload.Should().Contain("\"retainedVoiceOutcome\":\"SkippedNoBucketConfigured\"",
            "and it must say WHICH non-purge this was — a skip is not the same as a failure");
    }

    /// <summary>
    /// The REAL store's blank-bucket branch, not a fake standing in for it.
    ///
    /// <para>
    /// <see cref="NoBucketConfiguredSkip_IsRecordedAsResidue_NotAsAPurge"/> proves
    /// the worker handles the status correctly, but it hands the worker a fake
    /// that returns that status directly — so it never exercises the
    /// blank-bucket short-circuit in <c>S3RetainedBlobStore</c>, which is the
    /// branch that actually fires in production. Without this test the claim "a
    /// blank bucket name yields SkippedNoBucketConfigured" is an assertion
    /// about code no test runs.
    /// </para>
    ///
    /// <para>
    /// The <see cref="IAmazonS3"/> stub is deliberately throw-on-everything: if
    /// the short-circuit ever regresses into calling S3, this fails loudly
    /// instead of silently passing.
    /// </para>
    ///
    /// <para>
    /// <b>This test used to assert the opposite.</b> It was named
    /// <c>..._AndDeletesTheMetadataRow</c> and required the row count to reach
    /// zero, pinning in place the very behaviour the rest of this file argues
    /// against — its own comment conceded the object "is still in the bucket"
    /// while asserting we had destroyed the row locating it. Two rules decide
    /// it: never destroy the sole index to data you still retain, and never
    /// report a deletion you did not perform. Both point the same way, so the
    /// assertion flipped.
    /// </para>
    /// </summary>
    [Fact]
    public async Task RealStore_WithBlankBucketName_ReturnsSkipped_AndLeavesTheMetadataRow()
    {
        var clipId = Guid.NewGuid();
        await SeedRetainedClipAsync(clipId, _userId);

        var options = Microsoft.Extensions.Options.Options.Create(
            new ShramSafal.Infrastructure.Privacy.RetainedBlobStoreOptions { BucketName = string.Empty });

        await using var provider = BuildProvider(new NoOpRetainedBlobStore());
        await using var scope = provider.CreateAsyncScope();

        // The scoped context carries TenantConnectionInterceptor, which
        // fail-closes without a claim. Production reaches this store through
        // ErasureWorker's admin-elevated context, so elevate to match.
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var store = new S3RetainedBlobStore(new ThrowOnDeleteObjectS3(), options, db);

        var outcome = await store.DeleteRetainedVoiceForUserAsync(_userId, CancellationToken.None);

        outcome.Status.Should().Be(RetainedVoiceDeletionStatus.SkippedNoBucketConfigured,
            "rows existed and no S3 object was touched — that is residue, not a purge");
        outcome.CanBeReportedAsDeleted.Should().BeFalse(
            "nothing was deleted, so nothing may be reported as deleted");

        // The row survives. The object is still sitting in the bucket, and this
        // row is the only thing that locates it: destroying the row would make
        // the farmer's audio simultaneously unreachable by them and undeleted
        // in fact — unrecoverable on retry, and invisible. And because this
        // runs on the DPDP §12 erasure path, recording a deletion we did not
        // perform would put a claim in the erasure record that we cannot
        // support.
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        var remaining = Convert.ToInt32(await ScalarAsync(raw,
            "SELECT count(*) FROM ssf.voice_clips_retained WHERE clip_id = @cid", ("cid", clipId)));
        remaining.Should().Be(1,
            "with no bucket the audio cannot be deleted, so the row that locates it must stay");

        // Counts must agree with the row that is still there: nothing removed
        // on either half, one clip left behind and counted rather than implied
        // by silence.
        outcome.BlobsDeleted.Should().Be(0);
        outcome.MetadataRowsRemoved.Should().Be(0);
        outcome.ClipsLeftInPlace.Should().Be(1);
    }

    /// <summary>
    /// The I1 fallback's SUCCESS path — previously unexercised in either
    /// direction.
    ///
    /// <para>
    /// My earlier report justified the gap with "no seam exists". That was
    /// wrong: <see cref="IAdminDbContextFactory{TContext}"/> is resolved from
    /// the container at every call site, so a throwing implementation is a
    /// one-class substitution — the same shape the suite already uses for
    /// <see cref="IRetainedBlobStore"/>.
    /// </para>
    ///
    /// <para>
    /// The substitute factory does NOT discriminate between call sites and fails
    /// no context creation. Every context it hands back carries an interceptor
    /// that throws on <b>that context's own</b> second save. What makes it land
    /// on the right one is arithmetic, not targeting:
    /// <c>ProcessOneAsync</c> saves twice on its context (<c>MarkInProgress</c>,
    /// then the record write), so its second save IS the record write; the
    /// fallback's fresh context saves once, so it is still at save #1 and
    /// survives to rescue the run. The nine anonymizers never enter the count —
    /// they use <c>ExecuteSqlRawAsync</c>/<c>ExecuteDeleteAsync</c>, which do not
    /// raise <c>SavingChangesAsync</c>.
    /// </para>
    /// </summary>
    [Fact]
    public async Task WhenTheMainRecordWriteFails_TheFallbackStillLandsATerminalRecord()
    {
        var requestId = await SeedErasureRequestAsync();

        var services = BaseServices();
        services.AddSingleton<IRetainedBlobStore>(new NoOpRetainedBlobStore());
        services.UseAdminFactoryFailingOnRecordWrite();

        await using var provider = services.BuildServiceProvider();
        await RunWorkerWithProviderAsync(provider, requestId);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();

        var status = Convert.ToInt32(await ScalarAsync(raw,
            "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)));

        status.Should().NotBe((int)ErasureStatus.Failed,
            "the scrub committed, so stamping Failed is the lie this whole task removes — the " +
            "fallback exists to write a terminal record when the primary write cannot");
        status.Should().BeOneOf(
            [(int)ErasureStatus.Completed, (int)ErasureStatus.CompletedWithResidue]);

        var payload = (string?)await ScalarAsync(raw,
            """
            SELECT payload::text FROM ssf.audit_events
             WHERE entity_type = 'ErasureRequest' AND entity_id = @id
             ORDER BY occurred_at_utc DESC LIMIT 1
            """,
            ("id", requestId));

        payload.Should().NotBeNull("a degraded record is still a record");
        payload!.Should().Contain("\"degradedRecord\":true",
            "and it must say it is thinner than normal, so missing per-row events are not read " +
            "as 'those tables were untouched'");
        payload.Should().Contain("\"targetUserId\"",
            "a DPDP handler arrives holding a subject, not a request id");
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
    private ServiceCollection BaseServices()
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
        return services;
    }

    private ServiceProvider BuildProvider(IRetainedBlobStore retainedStore)
    {
        var services = BaseServices();
        services.AddSingleton(retainedStore);
        return services.BuildServiceProvider();
    }

    private async Task RunWorkerAsync(IRetainedBlobStore retainedStore, Guid requestId)
    {
        await using var provider = BuildProvider(retainedStore);
        await RunWorkerWithProviderAsync(provider, requestId);
    }

    private async Task RunWorkerWithProviderAsync(ServiceProvider provider, Guid requestId)
    {
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
        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct) =>
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

    /// <summary>
    /// The kill-switch shape: no exception, no S3 call, and NOTHING removed —
    /// neither the object nor the metadata row that points at it. This is what
    /// <c>S3RetainedBlobStore</c> does when <c>RetainedBlobStore:BucketName</c>
    /// is blank — a state <c>aws/voice-retained/README.md:148</c> offers as a
    /// supported rollback whose stated effect is "clips remain in S3
    /// untouched".
    ///
    /// <para>
    /// This fake used to describe itself as removing the metadata rows,
    /// because the adapter used to. Leaving the row is the point: the object
    /// is still in the bucket, and the row is the only index to it.
    /// </para>
    /// </summary>
    private sealed class SkippingRetainedBlobStore : IRetainedBlobStore
    {
        /// <summary>
        /// The scenario this fake models: a user holding one retained clip
        /// that the blank bucket made untouchable. It is not tuned to any
        /// assertion — no test reads the count — but it cannot be zero and
        /// stay coherent, because a user with no rows takes the
        /// <c>NothingToDelete</c> branch instead of this one.
        /// </summary>
        private const int ClipsLeftInPlace = 1;

        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(RetainedVoiceDeletionOutcome.SkippedNoBucket(ClipsLeftInPlace));

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// Throws on <see cref="DeleteObjectAsync(string, string, CancellationToken)"/>
    /// — the only call the branch under test could make — so a regression that
    /// starts deleting fails loudly instead of passing against a permissive fake.
    ///
    /// <para>
    /// <b>Named for exactly what it does.</b> It was briefly called
    /// <c>ThrowOnAnyCallS3</c>, which the corrected docstring below then
    /// contradicted — a name asserting more than the code delivers is the same
    /// defect as a comment doing it, and harder to notice because the name is
    /// what the call site reads.
    /// </para>
    ///
    /// <para>
    /// <b>Not a blanket guarantee.</b> This overrides one overload, not every
    /// member. Any other S3 call would fall through to the real
    /// <see cref="Amazon.S3.AmazonS3Client"/> base with dummy credentials and
    /// attempt a network request — slow, and failing for the wrong reason. If
    /// this fake is reused for a path that can reach other S3 operations,
    /// override those too rather than trusting the class name.
    /// </para>
    /// </summary>
    private sealed class ThrowOnDeleteObjectS3 : Amazon.S3.AmazonS3Client
    {
        public ThrowOnDeleteObjectS3()
            : base(new Amazon.Runtime.BasicAWSCredentials("test", "test"),
                   Amazon.RegionEndpoint.APSouth1)
        {
        }

        public override Task<Amazon.S3.Model.DeleteObjectResponse> DeleteObjectAsync(
            string bucketName, string key, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException(
                "S3 must not be called on the blank-bucket short-circuit path.");
    }

    /// <summary>
    /// Genuinely purges — the clean-path control.
    ///
    /// <para>
    /// Holds no state, so it reports the scenario it stands for rather than a
    /// measurement: one clip found, both halves removed. No test reads the
    /// count. It cannot be zero and stay coherent — <c>Deleted</c> means at
    /// least one clip was found and removed, so <c>Removed(0)</c> would assert
    /// a purge of nothing.
    /// </para>
    /// </summary>
    private sealed class NoOpRetainedBlobStore : IRetainedBlobStore
    {
        private const int ClipsPurged = 1;

        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct) =>
            Task.FromResult(RetainedVoiceDeletionOutcome.Removed(ClipsPurged));

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

    /// <summary>One retained-clip metadata row, all NOT NULL columns populated.</summary>
    private async Task SeedRetainedClipAsync(Guid clipId, Guid userId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.voice_clips_retained
                (clip_id, user_id, recorded_at_utc, s3_key, dek_id, iv_b64, auth_tag_b64,
                 duration_seconds, language, created_at_utc)
            VALUES (@cid, @uid, NOW(), @key, 'dek-test', 'iv', 'tag', 12, 'mr-IN', NOW());
            """;
        c.Parameters.AddWithValue("cid", clipId);
        c.Parameters.AddWithValue("uid", userId);
        c.Parameters.AddWithValue("key", $"retained/{userId:N}/{clipId:N}.bin");
        await c.ExecuteNonQueryAsync();
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

/// <summary>
/// Drives the I1 fallback by failing the ONE call that matters: the record
/// write at the end of <c>ProcessOneAsync</c>.
///
/// <para>
/// The seam is a <see cref="SaveChangesInterceptor"/> attached to an otherwise
/// ordinary <see cref="ShramSafalDbContext"/> — NOT a subclass, because
/// <c>ShramSafalDbContext</c> is declared <c>sealed</c> and cannot be derived
/// from. It throws on the context's second save.
/// <c>ProcessOneAsync</c> saves exactly twice on its context — once for
/// <c>MarkInProgress</c>, once for the audit + status — so failing the second
/// reproduces "everything scrubbed and committed, then the record write died"
/// without disturbing anything before it.
/// </para>
///
/// <para>
/// An earlier attempt disposed the whole context instead. That was too blunt: it
/// broke the FIRST save too, so the scrub never ran and the test was measuring
/// a different failure entirely. Worth stating, because a seam that fails too
/// early looks identical in the status column.
/// </para>
///
/// <para>
/// The fallback's own fresh context saves only once, so it is unaffected and can
/// still land the record — which is the behaviour under test.
/// </para>
/// </summary>
internal static class FailingAdminFactoryRegistration
{
    public static void UseAdminFactoryFailingOnRecordWrite(this IServiceCollection services) =>
        services.AddScoped<IAdminDbContextFactory<ShramSafalDbContext>>(sp =>
            new FailingAdminDbContextFactory(sp.GetRequiredService<IConfiguration>()));
}

internal sealed class FailingAdminDbContextFactory(IConfiguration configuration)
    : IAdminDbContextFactory<ShramSafalDbContext>
{
    public Task<ShramSafalDbContext> CreateAsync(string reason, Guid actorUserId, CancellationToken ct)
    {
        var connectionString =
            configuration.GetConnectionString("ShramSafalDb_Migration")
            ?? configuration.GetConnectionString("ShramSafalDb")
            ?? throw new InvalidOperationException("No ShramSafalDb connection string available.");

        // Same OPTIONS shape as the real factory — no
        // TenantConnectionInterceptor, so the owner connection bypasses RLS
        // exactly as in production — plus the one seam this test needs.
        //
        // It is NOT a full stand-in for ShramSafalAdminDbContextFactory: that
        // one also commits an 'admin_cross_tenant'/'open' audit row on a
        // parallel context BEFORE returning, and this does not. Harmless here
        // (nothing under test reads those rows) but it means the audit ledger
        // in this test has fewer rows than production would — do not use this
        // factory to assert anything about audit-row counts.
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(connectionString)
            .AddInterceptors(new ThrowOnSecondSaveInterceptor())
            .Options;

        return Task.FromResult(new ShramSafalDbContext(options));
    }
}

internal sealed class ThrowOnSecondSaveInterceptor : SaveChangesInterceptor
{
    private int _saves;

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (Interlocked.Increment(ref _saves) == 2)
        {
            throw new InvalidOperationException(
                "Simulated failure of the erasure record write (I1). The scrub is already committed "
                + "at this point; the fallback must still land a terminal record.");
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
