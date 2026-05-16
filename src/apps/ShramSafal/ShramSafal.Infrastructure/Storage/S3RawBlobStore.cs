// TODO(spine-02.1.7): LocalStack-backed integration test deferred to sub-phase 02.1bis pending fixture infrastructure.
// Project hygiene (per `_COFOUNDER/memory/...` "avoid Docker on local dev") + no LocalStackContainer
// fixture exists yet in ShramSafal.Sync.IntegrationTests. The idempotent-put assertion lives in the
// plan recipe (step 2.1.7) and will land once a Testcontainers LocalStack fixture is in place.
//
// 02-patch (cold-storage wiring): the S3 object key shape is now `raw/{sha256}` with
// no extension — the PUT path uses `blobRef.S3Key` produced by the new RawBlobRef
// factory, and the GET / DereferenceAsync paths reconstruct the same shape from the
// SHA-256 directly. Extension was decorative; content type lives in `ContentType` on
// RawBlobRef, on the S3 object metadata (PutObjectRequest.ContentType below), and on
// the `ssf.raw_blob_index.content_type` column.

using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Storage;
using ShramSafal.Domain.Storage;

namespace ShramSafal.Infrastructure.Storage;

/// <summary>
/// S3-backed implementation of <see cref="IRawBlobStore"/>. Content-addressed keys make
/// PUTs idempotent — a HEAD-then-PUT pattern lets repeat uploads of identical content
/// short-circuit without re-writing the object. Sub-phase 02.1 of
/// DATA_PRINCIPLE_SPINE_2026-05-05.
/// </summary>
public sealed class S3RawBlobStore : IRawBlobStore
{
    private readonly IAmazonS3 _s3;
    private readonly RawBlobStoreOptions _opt;

    public S3RawBlobStore(IAmazonS3 s3, IOptions<RawBlobStoreOptions> opt)
    {
        _s3 = s3;
        _opt = opt.Value;
    }

    public async Task<RawBlobRef> PutAsync(Stream payload, string contentType, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(payload);

        using var ms = new MemoryStream();
        await payload.CopyToAsync(ms, ct);
        var bytes = ms.ToArray();
        var blobRef = RawBlobRef.FromBytes(bytes, contentType);

        // Idempotent put: HEAD first; skip if exists. Two concurrent writers of the
        // same content race harmlessly — the loser's PutObject overwrites with bit-
        // identical bytes and the SHA-256 key remains stable.
        try
        {
            await _s3.GetObjectMetadataAsync(_opt.BucketName, blobRef.S3Key, ct);
            return blobRef;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // expected on first sighting — fall through to PUT
        }

        using var put = new MemoryStream(bytes);
        var request = new PutObjectRequest
        {
            BucketName = _opt.BucketName,
            Key = blobRef.S3Key,
            ContentType = contentType,
            InputStream = put,
            AutoCloseStream = false,
        };

        // Delta 2: nullable KmsKeyId. When configured, use AWS-KMS SSE with the
        // supplied alias/ARN. When absent (dev / local), fall back to AES256 SSE —
        // mirrors S3AttachmentStorageService:39 so both adapters behave identically
        // against a dev bucket that has no provisioned CMK.
        if (string.IsNullOrWhiteSpace(_opt.KmsKeyId))
        {
            request.ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256;
        }
        else
        {
            request.ServerSideEncryptionMethod = ServerSideEncryptionMethod.AWSKMS;
            request.ServerSideEncryptionKeyManagementServiceKeyId = _opt.KmsKeyId;
        }

        await _s3.PutObjectAsync(request, ct);
        return blobRef;
    }

    public async Task<Stream> GetAsync(string sha256, CancellationToken ct)
    {
        // Caller owns disposal of the returned stream (see IRawBlobStore.GetAsync XML doc).
        var resp = await _s3.GetObjectAsync(_opt.BucketName, $"raw/{sha256}", ct);
        return resp.ResponseStream;
    }

    public async Task DereferenceAsync(string sha256, CancellationToken ct)
    {
        // Phase 02 leaves dereference as a hard-delete; Phase 08 introduces ref-counted erasure.
        await _s3.DeleteObjectAsync(_opt.BucketName, $"raw/{sha256}", ct);
    }
}
