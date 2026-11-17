namespace ShramSafal.Application.Ports.External;

public interface IAttachmentStorageService
{
    Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default);
    Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default);

    /// <summary>
    /// spec: plr-d10 lane SCH-ID-S - removes the file at <paramref name="relativePath"/>. Idempotent: a file that is not there is not an error.
    /// Added for pictures (a replaced or removed picture, an erased person's picture); attachments never delete.
    /// </summary>
    Task DeleteAsync(string relativePath, CancellationToken ct = default);
}
