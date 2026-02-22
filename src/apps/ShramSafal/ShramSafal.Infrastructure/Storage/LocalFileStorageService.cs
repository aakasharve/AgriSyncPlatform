using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Storage;

internal sealed class LocalFileStorageService(IOptions<StorageOptions> storageOptions) : IAttachmentStorageService
{
    private readonly StorageOptions _storageOptions = storageOptions.Value;

    public async Task<string> StoreFileAsync(Stream fileStream, string farmId, string fileName, CancellationToken ct)
    {
        var normalizedFarmId = NormalizeSegment(farmId, "farmId");
        var relativePath = NormalizeRelativePath(fileName);
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            relativePath = $"{DateTime.UtcNow:yyyy-MM}/{Guid.NewGuid():N}.bin";
        }
        else if (!relativePath.Contains('/'))
        {
            relativePath = $"{DateTime.UtcNow:yyyy-MM}/{relativePath}";
        }

        var absolutePath = Path.Combine(
            GetAttachmentRootDirectory(),
            normalizedFarmId,
            relativePath.Replace('/', Path.DirectorySeparatorChar));

        var targetDirectory = Path.GetDirectoryName(absolutePath)
            ?? throw new InvalidOperationException("Unable to resolve attachment directory.");

        Directory.CreateDirectory(targetDirectory);

        await using var output = new FileStream(
            absolutePath,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            bufferSize: 81920,
            useAsync: true);

        await fileStream.CopyToAsync(output, ct);
        await output.FlushAsync(ct);

        return $"attachments/{normalizedFarmId}/{relativePath}";
    }

    public Task<Stream> RetrieveFileAsync(string storagePath, CancellationToken ct)
    {
        var absolutePath = ResolveAbsolutePath(storagePath);
        if (!File.Exists(absolutePath))
        {
            throw new FileNotFoundException("Attachment file was not found in local storage.", storagePath);
        }

        Stream stream = new FileStream(
            absolutePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            useAsync: true);

        return Task.FromResult(stream);
    }

    public Task<bool> ExistsAsync(string storagePath, CancellationToken ct)
    {
        var absolutePath = ResolveAbsolutePath(storagePath);
        return Task.FromResult(File.Exists(absolutePath));
    }

    private string ResolveAbsolutePath(string storagePath)
    {
        if (string.IsNullOrWhiteSpace(storagePath))
        {
            throw new ArgumentException("Storage path is required.", nameof(storagePath));
        }

        var relativePath = NormalizeRelativePath(storagePath);
        if (!relativePath.StartsWith("attachments/", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("Storage path must be rooted under attachments/.", nameof(storagePath));
        }

        var trimmed = relativePath["attachments/".Length..];
        return Path.Combine(GetAttachmentRootDirectory(), trimmed.Replace('/', Path.DirectorySeparatorChar));
    }

    private string GetAttachmentRootDirectory()
    {
        var dataDirectory = _storageOptions.DataDirectory?.Trim();
        if (string.IsNullOrWhiteSpace(dataDirectory))
        {
            dataDirectory = "./data";
        }

        var rootedDataDirectory = Path.IsPathRooted(dataDirectory)
            ? dataDirectory
            : Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, dataDirectory));

        return Path.Combine(rootedDataDirectory, "attachments");
    }

    private static string NormalizeRelativePath(string value)
    {
        var normalized = value.Replace('\\', '/').Trim().Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return string.Empty;
        }

        var segments = normalized
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment =>
            {
                if (segment is "." or "..")
                {
                    throw new ArgumentException("Path traversal segments are not allowed.", nameof(value));
                }

                return SanitizePathSegment(segment);
            })
            .ToArray();

        return string.Join('/', segments);
    }

    private static string NormalizeSegment(string value, string argumentName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Value is required.", argumentName);
        }

        return SanitizePathSegment(value.Trim());
    }

    private static string SanitizePathSegment(string segment)
    {
        var invalidCharacters = Path.GetInvalidFileNameChars();
        var buffer = segment
            .Select(ch => invalidCharacters.Contains(ch) ? '_' : ch)
            .ToArray();

        var sanitized = new string(buffer).Trim();
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            throw new ArgumentException("Path segment resolves to an empty value.");
        }

        return sanitized;
    }
}
