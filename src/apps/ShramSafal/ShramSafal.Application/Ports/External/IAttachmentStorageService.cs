namespace ShramSafal.Application.Ports.External;

public interface IAttachmentStorageService
{
    Task<long> SaveAsync(string relativePath, Stream content, CancellationToken ct = default);
    Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default);
}
