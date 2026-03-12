using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Storage;

internal sealed class S3AttachmentStorageService(
    IAmazonS3 s3Client,
    IOptions<StorageOptions> options) : IAttachmentStorageService
{
    private readonly StorageOptions storageOptions = options.Value;

    public async Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default)
    {
        if (content is null)
        {
            throw new ArgumentNullException(nameof(content));
        }

        var bucketName = ResolveBucketName();
        var objectKey = ResolveObjectKey(relativePath);
        await using var buffer = new MemoryStream();
        if (content.CanSeek)
        {
            content.Position = 0;
        }

        await content.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        var request = new PutObjectRequest
        {
            BucketName = bucketName,
            Key = objectKey,
            InputStream = buffer,
            AutoCloseStream = false,
            ContentType = string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim(),
            ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256
        };

        await s3Client.PutObjectAsync(request, ct);
        return buffer.Length;
    }

    public async Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default)
    {
        var bucketName = ResolveBucketName();
        var objectKey = ResolveObjectKey(relativePath);

        try
        {
            using var response = await s3Client.GetObjectAsync(bucketName, objectKey, ct);
            await using var responseStream = response.ResponseStream;
            var buffer = new MemoryStream();
            await responseStream.CopyToAsync(buffer, ct);
            buffer.Position = 0;
            return buffer;
        }
        catch (AmazonS3Exception ex) when (
            ex.StatusCode == System.Net.HttpStatusCode.NotFound ||
            string.Equals(ex.ErrorCode, "NoSuchKey", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
    }

    private string ResolveBucketName()
    {
        if (string.IsNullOrWhiteSpace(storageOptions.BucketName))
        {
            throw new InvalidOperationException("ShramSafal:Storage:BucketName must be configured when using S3 storage.");
        }

        return storageOptions.BucketName.Trim();
    }

    private string ResolveObjectKey(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            throw new ArgumentException("Relative path is required.", nameof(relativePath));
        }

        var segments = relativePath
            .Replace('\\', '/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (segments.Length == 0 || segments.Any(segment => segment == ".."))
        {
            throw new InvalidOperationException("Resolved storage path is invalid.");
        }

        var normalized = string.Join("/", segments);
        var keyPrefix = storageOptions.KeyPrefix?.Trim().Trim('/');
        if (string.IsNullOrWhiteSpace(keyPrefix) ||
            normalized.StartsWith($"{keyPrefix}/", StringComparison.OrdinalIgnoreCase) ||
            normalized.StartsWith("ai-sessions/", StringComparison.OrdinalIgnoreCase))
        {
            return normalized;
        }

        return $"{keyPrefix}/{normalized}";
    }
}
