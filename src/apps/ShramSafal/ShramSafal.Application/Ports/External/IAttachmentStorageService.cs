namespace ShramSafal.Application.Ports.External;

public interface IAttachmentStorageService
{
    Task<string> StoreFileAsync(Stream fileStream, string farmId, string fileName, CancellationToken ct);
    Task<Stream> RetrieveFileAsync(string storagePath, CancellationToken ct);
    Task<bool> ExistsAsync(string storagePath, CancellationToken ct);
}
