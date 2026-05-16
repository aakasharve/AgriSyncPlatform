// spec: data-principle-spine-2026-05-05/02-MAJOR-4
// Closes Phase 02 "documented_test_debt" by exercising S3RawBlobStore against a
// LocalStack-backed S3 endpoint. Mirrors the AnalyticsMigrationTests harness
// pattern: spin a Testcontainer per fact, wire the SDK at the LocalStack edge,
// and assert the round-trip + idempotency guarantees encoded by RawBlobRef's
// content-addressed key shape.

using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.Extensions.Options;
using ShramSafal.Domain.Storage;
using ShramSafal.Infrastructure.Storage;
using Testcontainers.LocalStack;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Storage;

/// <summary>
/// 02-MAJOR-4 closure: PUT → GET → DELETE round-trip plus the content-addressed
/// idempotency guarantee on <see cref="S3RawBlobStore"/>, exercised against a
/// real S3 API via Testcontainers' LocalStack image. Closes the
/// "documented_test_debt" gap left by Phase 02 (the TODO that previously sat
/// at the top of S3RawBlobStore.cs).
///
/// <para>
/// <b>Trait("Category","RequiresDocker").</b> The fixture spins a fresh
/// LocalStack container per <c>IAsyncLifetime</c>. CI runs these as part of the
/// integration sweep; local Docker-less environments skip by trait filter
/// (project hygiene rule — no Docker on local dev for MVP).
/// </para>
/// </summary>
[Trait("Category", "RequiresDocker")]
public sealed class S3RawBlobStoreIntegrationTests : IAsyncLifetime
{
    private const string BucketName = "agrisync-raw-test";

    // Testcontainers 4.x marks parameterless builders obsolete; the .WithImage()
    // call below pins the image deterministically and is functionally equivalent.
    // Mirror AnalyticsMigrationTests.cs:62-68 so CI's -warnaserror passes.
#pragma warning disable CS0618 // Type or member is obsolete
    private readonly LocalStackContainer _localStack = new LocalStackBuilder()
        .WithImage("localstack/localstack:3.8")
        .Build();
#pragma warning restore CS0618

    private IAmazonS3 _s3 = null!;
    private S3RawBlobStore _store = null!;

    public async Task InitializeAsync()
    {
        await _localStack.StartAsync();

        var endpoint = _localStack.GetConnectionString(); // e.g. http://127.0.0.1:4566

        var s3Config = new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true, // LocalStack requires path-style addressing
            AuthenticationRegion = RegionEndpoint.USEast1.SystemName,
        };

        // Credentials are LocalStack's "test/test" defaults — any non-empty
        // pair works; LocalStack accepts everything in default profile mode.
        _s3 = new AmazonS3Client("test", "test", s3Config);

        await _s3.PutBucketAsync(new PutBucketRequest
        {
            BucketName = BucketName,
        });

        // Match the dev/local pattern: no KmsKeyId → S3RawBlobStore falls
        // back to AES256 SSE (LocalStack accepts AES256 happily; we don't
        // need an actual KMS key provisioned).
        var options = Options.Create(new RawBlobStoreOptions
        {
            BucketName = BucketName,
            Region = RegionEndpoint.USEast1.SystemName,
            KmsKeyId = null,
        });

        _store = new S3RawBlobStore(_s3, options);
    }

    public async Task DisposeAsync()
    {
        _s3?.Dispose();
        await _localStack.DisposeAsync();
    }

    [Fact]
    public async Task PutAsync_returns_RawBlobRef_with_sha256_key_no_extension()
    {
        var bytes = Encoding.UTF8.GetBytes("hello-spine-02-major-4");
        using var payload = new MemoryStream(bytes);

        var blobRef = await _store.PutAsync(payload, "audio/opus", CancellationToken.None);

        blobRef.Should().NotBeNull();
        blobRef.ContentType.Should().Be("audio/opus");
        blobRef.SizeBytes.Should().Be(bytes.Length);
        blobRef.Sha256.Should().MatchRegex("^[0-9a-f]{64}$",
            "SHA-256 is the natural primary key; RawBlobRef stamps lowercase hex");
        blobRef.S3Key.Should().Be($"raw/{blobRef.Sha256}",
            "spec 02-patch: S3 keys are `raw/{sha256}` with NO extension");
        blobRef.S3Key.Should().NotContain(".",
            "extension was decorative and was dropped in spine-02-patch");
    }

    [Fact]
    public async Task PutAsync_is_idempotent_for_same_content()
    {
        var bytes = Encoding.UTF8.GetBytes("idempotent-payload-spine-02");
        using var first = new MemoryStream(bytes);
        using var second = new MemoryStream(bytes);

        var refA = await _store.PutAsync(first, "image/jpeg", CancellationToken.None);
        var refB = await _store.PutAsync(second, "image/jpeg", CancellationToken.None);

        refA.S3Key.Should().Be(refB.S3Key,
            "content-addressed keys collapse repeat uploads of identical bytes");

        var listing = await _s3.ListObjectsV2Async(new ListObjectsV2Request
        {
            BucketName = BucketName,
            Prefix = "raw/",
        }, CancellationToken.None);

        listing.S3Objects
            .Where(o => o.Key == refA.S3Key)
            .Should()
            .ContainSingle("the HEAD-then-PUT short-circuit must leave exactly one object per content hash");
    }

    [Fact]
    public async Task GetAsync_round_trips_bytes()
    {
        var bytes = Encoding.UTF8.GetBytes("round-trip-payload-spine-02-major-4");
        using var payload = new MemoryStream(bytes);

        var blobRef = await _store.PutAsync(payload, "application/octet-stream", CancellationToken.None);

        await using var read = await _store.GetAsync(blobRef.Sha256, CancellationToken.None);
        using var copy = new MemoryStream();
        await read.CopyToAsync(copy, CancellationToken.None);

        copy.ToArray().Should().Equal(bytes,
            "GetAsync must return the exact bytes PutAsync stored (no transcoding, no truncation)");
    }

    [Fact]
    public async Task DereferenceAsync_deletes_object()
    {
        var bytes = Encoding.UTF8.GetBytes("delete-me-spine-02");
        using var payload = new MemoryStream(bytes);
        var blobRef = await _store.PutAsync(payload, "audio/opus", CancellationToken.None);

        await _store.DereferenceAsync(blobRef.Sha256, CancellationToken.None);

        var act = async () => await _s3.GetObjectAsync(
            BucketName,
            blobRef.S3Key,
            CancellationToken.None);

        var thrown = await act.Should().ThrowAsync<AmazonS3Exception>();
        thrown.Which.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "DereferenceAsync hard-deletes in Phase 02; ref-counted erasure lands in Phase 08");
    }
}
