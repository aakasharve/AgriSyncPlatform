using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Application.Ports;

/// <summary>The pointer to a person's own face: the picture's id and the file's SHA-256 (the phone's cache key and the file's ETag).</summary>
public sealed record MePictureSnapshot(Guid PictureId, string Sha256);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3). His own PERSON picture, for his identity card. The picture lives in
/// ShramSafal (<c>ssf.pictures</c>), so the reader is implemented in the composition root, like <see cref="IMeInvitationSnapshotReader"/>: this context
/// never references ShramSafal. <c>null</c> = he has set no picture.
/// </summary>
public interface IMePictureSnapshotReader
{
    Task<MePictureSnapshot?> GetForUserAsync(UserId userId, CancellationToken ct = default);
}
