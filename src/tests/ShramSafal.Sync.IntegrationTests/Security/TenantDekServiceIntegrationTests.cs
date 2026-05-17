// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 integration test for KmsTenantDekService against a
// LocalStack KMS instance. Forked from S3RawBlobStoreIntegrationTests so
// each fact owns its own LocalStack container (IAsyncLifetime). LocalStack
// 3.x ships with KMS enabled by default; no explicit service config needed.
//
// Coverage (per envelope):
//   (a) IssueAsync returns a TenantDek with DekBytes.Length == 32 (AES-256)
//   (b) ResolveAsync with the wrong owner_account_id returns null
//       (EncryptionContext mismatch surfaces as InvalidCiphertextException
//        inside the SDK and the adapter swallows it to null)
//   (c) Round-trip — Issue then Resolve with the same owner returns the
//       same plaintext bytes (sanity that the wrap/unwrap pair is correct)

using System;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Security;
using Amazon;
using Amazon.KeyManagementService;
using Amazon.KeyManagementService.Model;
using FluentAssertions;
using Microsoft.Extensions.Options;
using Testcontainers.LocalStack;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Security;

/// <summary>
/// Round-trip coverage for <see cref="KmsTenantDekService"/> against a
/// LocalStack-backed KMS endpoint. LocalStack accepts the
/// <c>GenerateDataKey</c> / <c>Decrypt</c> APIs with
/// <c>EncryptionContext</c> binding, which is exactly the surface we
/// depend on.
///
/// <para>
/// <b>Trait("Category","RequiresDocker").</b> CI sweeps; local Docker-less
/// environments skip via trait filter (repo hygiene rule).
/// </para>
/// </summary>
[Trait("Category", "RequiresDocker")]
public sealed class TenantDekServiceIntegrationTests : IAsyncLifetime
{
    // Testcontainers 4.x marks parameterless builders obsolete; pin the
    // image explicitly to match S3RawBlobStoreIntegrationTests.cs:50-52.
#pragma warning disable CS0618 // Type or member is obsolete
    private readonly LocalStackContainer _localStack = new LocalStackBuilder()
        .WithImage("localstack/localstack:3.8")
        .Build();
#pragma warning restore CS0618

    private IAmazonKeyManagementService _kms = null!;
    private string _masterKeyId = null!;

    public async Task InitializeAsync()
    {
        await _localStack.StartAsync();

        var endpoint = _localStack.GetConnectionString(); // http://127.0.0.1:4566

        var kmsConfig = new AmazonKeyManagementServiceConfig
        {
            ServiceURL = endpoint,
            AuthenticationRegion = RegionEndpoint.USEast1.SystemName,
        };

        // LocalStack accepts any credentials in default profile mode.
        _kms = new AmazonKeyManagementServiceClient("test", "test", kmsConfig);

        // Provision a fresh customer master key — LocalStack returns a real
        // KeyId we can pass into TenantDekOptions.MasterKeyId. Using the
        // raw KeyId (not an alias) avoids the alias-creation round trip.
        var createKey = await _kms.CreateKeyAsync(new CreateKeyRequest
        {
            Description = "test-tenant-dek-cmk",
            KeyUsage = KeyUsageType.ENCRYPT_DECRYPT,
        });

        _masterKeyId = createKey.KeyMetadata.KeyId;
    }

    public async Task DisposeAsync()
    {
        _kms?.Dispose();
        await _localStack.DisposeAsync();
    }

    private KmsTenantDekService BuildService() =>
        new(_kms, Options.Create(new TenantDekOptions { MasterKeyId = _masterKeyId }));

    [Fact]
    public async Task IssueAsync_returns_aes256_plaintext_and_24h_expiry()
    {
        var service = BuildService();
        var owner = Guid.NewGuid();

        var dek = await service.IssueAsync(owner, CancellationToken.None);

        dek.Should().NotBeNull();
        dek.DekBytes.Length.Should().Be(32,
            "AES_256 KeySpec must hand back a 32-byte plaintext key");
        dek.DekId.Should().NotBeNullOrWhiteSpace(
            "the wrapped form is what callers persist next to the ciphertext");
        dek.ExpiresAtUtc.Should().BeAfter(DateTime.UtcNow.AddHours(23),
            "lifetime contract is 24h per call");
        dek.ExpiresAtUtc.Should().BeBefore(DateTime.UtcNow.AddHours(25),
            "lifetime contract is 24h per call");
    }

    [Fact]
    public async Task ResolveAsync_with_correct_owner_returns_same_plaintext()
    {
        var service = BuildService();
        var owner = Guid.NewGuid();

        var issued = await service.IssueAsync(owner, CancellationToken.None);
        var resolved = await service.ResolveAsync(owner, issued.DekId, CancellationToken.None);

        resolved.Should().NotBeNull(
            "ResolveAsync with the same owner_account_id must unwrap");
        resolved!.Should().Equal(issued.DekBytes,
            "the unwrapped bytes must match the original plaintext");
    }

    [Fact]
    public async Task ResolveAsync_with_wrong_owner_returns_null()
    {
        var service = BuildService();
        var realOwner = Guid.NewGuid();
        var maliciousOwner = Guid.NewGuid();

        var issued = await service.IssueAsync(realOwner, CancellationToken.None);

        var crossTenantUnwrap = await service.ResolveAsync(
            maliciousOwner, issued.DekId, CancellationToken.None);

        crossTenantUnwrap.Should().BeNull(
            "EncryptionContext mismatch must surface as 'not resolvable'; "
            + "KMS throws InvalidCiphertextException and the adapter swallows it to null");
    }

    [Fact]
    public async Task ResolveAsync_with_malformed_dekid_returns_null()
    {
        var service = BuildService();
        var owner = Guid.NewGuid();

        var resolved = await service.ResolveAsync(owner, "not-a-valid-base64-blob!!!", CancellationToken.None);

        resolved.Should().BeNull(
            "malformed DekId is treated identically to a wrong-tenant unwrap");
    }
}
