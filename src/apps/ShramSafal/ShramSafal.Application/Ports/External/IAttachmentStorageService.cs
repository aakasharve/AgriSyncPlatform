namespace ShramSafal.Application.Ports.External;

public interface IAttachmentStorageService
{
    Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default);
    Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default);
}
