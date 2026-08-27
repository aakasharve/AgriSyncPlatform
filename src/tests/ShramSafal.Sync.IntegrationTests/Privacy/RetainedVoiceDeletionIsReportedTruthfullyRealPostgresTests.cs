// spec: dfes-companion-2026-07-11 (farm-memory)
//
// Founder ITEM 4, HARD RULE: "the system must never tell a farmer that
// something has been deleted when ARVE knowingly continues to retain the
// active copy." Doctrine P4 says the same about any number we report.
//
// The place that rule was breaking is small and easy to miss. The
// retained-voice delete used to return a bare Task, so a caller had no
// way to distinguish "the audio is gone" from "there was no bucket
// configured, so I dropped the metadata row and left the audio wherever
// it was". Worse, the no-bucket branch did exactly that second thing on
// the reasoning that without a bucket the objects cannot exist — true on
// a dev laptop, false in any environment whose BucketName is blank or
// mistyped while its bucket is full of a farmer's recordings. There the
// row is the only pointer to the audio; deleting it makes the recording
// unreachable by the farmer AND undeleted in fact, and then reports
// success.
//
// Two assertions follow, and they are separate on purpose. That nothing
// was destroyed is one claim. That the caller is TOLD nothing was
// destroyed is the other, and it is the one the HARD RULE is about — a
// silent skip that returns normally is indistinguishable from a purge
// to every caller downstream.

using System;
using System.Threading;
using System.Threading.Tasks;
using Amazon.S3;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class RetainedVoiceDeletionIsReportedTruthfullyRealPostgresTests(ITestOutputHelper output)
    : IAsyncLifetime
{
    private static readonly Guid FarmerUserId = Guid.Parse("17cc0000-0000-0000-0000-000000000001");
    private static readonly Guid ClipId = Guid.Parse("17cc0000-0000-0000-0000-0000000000a1");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;

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
        _scratchDbName = $"ssf_retained_truth_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (_skip || string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
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

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    [SkippableFact]
    public async Task With_no_bucket_configured_the_row_survives_and_the_caller_is_told_the_purge_did_not_happen()
    {
        SkipIfPostgresUnavailable();

        await using var db = NewContext();
        await SeedClipAsync(db);

        // Prove the clip is there before asserting that it survives.
        (await db.VoiceClipsRetained.CountAsync(c => c.UserId == FarmerUserId))
            .Should().Be(1, "the fixture must actually have written the row it is about to make claims about");

        // BucketName blank — the misconfiguration this is about.
        var store = new S3RetainedBlobStore(
            new UnusableS3Client(),
            Options.Create(new RetainedBlobStoreOptions { BucketName = string.Empty }),
            db);

        var outcome = await store.DeleteRetainedVoiceForUserAsync(FarmerUserId, CancellationToken.None);

        // 1. Nothing was destroyed. Dropping the metadata row here would
        //    orphan an object that may well exist and leave no pointer to
        //    it — unrecoverable, and invisible to the farmer.
        (await db.VoiceClipsRetained.CountAsync(c => c.UserId == FarmerUserId))
            .Should().Be(1, "with no bucket the audio cannot be deleted, so the row that locates it must stay");

        // 2. And the caller is TOLD. This is the assertion that actually
        //    enforces the HARD RULE: a skip that returns quietly reads to
        //    every downstream caller exactly like a successful purge, and
        //    that is how ErasureWorker came to stamp Completed on requests
        //    it had not satisfied.
        outcome.Status.Should().Be(RetainedVoiceDeletionStatus.SkippedNoBucketConfigured);
        outcome.CanBeReportedAsDeleted.Should().BeFalse(
            "no caller may describe this as a deletion — the active copy may still exist");
        outcome.BlobsDeleted.Should().Be(0);
        outcome.MetadataRowsRemoved.Should().Be(0);
        outcome.ClipsLeftInPlace.Should().Be(1, "the residue must be counted, not merely implied by silence");
    }

    [SkippableFact]
    public async Task A_user_with_no_retained_voice_reports_nothing_to_delete_and_that_is_honestly_reportable()
    {
        SkipIfPostgresUnavailable();

        await using var db = NewContext();

        var store = new S3RetainedBlobStore(
            new UnusableS3Client(),
            Options.Create(new RetainedBlobStoreOptions { BucketName = string.Empty }),
            db);

        var outcome = await store.DeleteRetainedVoiceForUserAsync(Guid.NewGuid(), CancellationToken.None);

        // "Nothing existed" is a different fact from "I deleted it", and
        // the enum keeps them apart — but unlike a skip it IS safe to
        // report to a farmer as "no retained voice remains", which is why
        // it groups with Deleted here and not with the skip.
        outcome.Status.Should().Be(RetainedVoiceDeletionStatus.NothingToDelete);
        outcome.CanBeReportedAsDeleted.Should().BeTrue();
        outcome.ClipsLeftInPlace.Should().Be(0);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private ShramSafalDbContext NewContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);

    private static async Task SeedClipAsync(ShramSafalDbContext db)
    {
        db.VoiceClipsRetained.Add(VoiceClipRetained.Create(
            clipId: ClipId,
            userId: FarmerUserId,
            recordedAtUtc: DateTime.UtcNow.AddDays(-3),
            s3Key: VoiceClipRetained.BuildS3Key(FarmerUserId, ClipId),
            dekId: "dek-truth",
            ivBase64: "AAAAAAAAAAAAAAAA",
            authTagBase64: "BBBBBBBBBBBBBBBB",
            durationSeconds: 5,
            language: "mr-IN",
            consentAuditId: null,
            nowUtc: DateTime.UtcNow));
        await db.SaveChangesAsync();
    }
}

/// <summary>
/// An <see cref="IAmazonS3"/> that throws on any use. The no-bucket path
/// must not reach S3 at all, and a mock that quietly returned success
/// would hide it if that ever changed.
/// </summary>
internal sealed class UnusableS3Client : AmazonS3Client
{
    public UnusableS3Client()
        : base("no-access-key", "no-secret-key", new AmazonS3Config
        {
            ServiceURL = "http://127.0.0.1:1",
            ForcePathStyle = true,
            MaxErrorRetry = 0,
        })
    {
    }
}
