using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Storage;

internal sealed class LocalFileStorageService : IAttachmentStorageService
{
    private readonly string rootDirectory;

    public LocalFileStorageService(IOptions<StorageOptions> options, IHostEnvironment hostEnvironment)
    {
        var configuredPath = options.Value.DataDirectory?.Trim();
        var basePath = string.IsNullOrWhiteSpace(configuredPath) ? "App_Data" : configuredPath;
        rootDirectory = Path.IsPathRooted(basePath)
            ? Path.GetFullPath(basePath)
            : Path.GetFullPath(Path.Combine(hostEnvironment.ContentRootPath, basePath));

        Directory.CreateDirectory(rootDirectory);
    }

    public async Task<long> SaveAsync(string relativePath, Stream content, CancellationToken ct = default)
    {
        var fullPath = ResolveSafePath(relativePath);
        var parentDirectory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrWhiteSpace(parentDirectory))
        {
            Directory.CreateDirectory(parentDirectory);
        }

        await using var fileStream = new FileStream(
            fullPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            81920,
            useAsync: true);

        await content.CopyToAsync(fileStream, ct);
        await fileStream.FlushAsync(ct);
        return fileStream.Length;
    }

    public Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default)
    {
        _ = ct;
        var fullPath = ResolveSafePath(relativePath);
        if (!File.Exists(fullPath))
        {
            return Task.FromResult<Stream?>(null);
        }

        Stream stream = new FileStream(
            fullPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);

        return Task.FromResult<Stream?>(stream);
    }

    private string ResolveSafePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            throw new ArgumentException("Relative path is required.", nameof(relativePath));
        }

        var normalized = relativePath.Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
        var combined = Path.GetFullPath(Path.Combine(rootDirectory, normalized));

        if (!combined.StartsWith(rootDirectory, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Resolved storage path is outside configured root.");
        }

        return combined;
    }
}
