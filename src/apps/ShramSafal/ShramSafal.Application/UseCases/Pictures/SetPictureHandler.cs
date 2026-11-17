using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Application.UseCases.Pictures;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). Sets (or replaces) a picture. The caller is the
/// authenticated person; the SUBJECT is never a body field (<see cref="PictureSubject"/>).
/// </summary>
/// <param name="Kind">Which kind of picture.</param>
/// <param name="RouteId">The schedule id of the route (SCHEDULE, INSTITUTION); ignored for PERSON.</param>
/// <param name="Content">The file. Read once, up to <see cref="PictureRules.MaxBytes"/> + 1.</param>
public sealed record SetPictureCommand(
    PictureKind Kind,
    Guid? RouteId,
    Stream Content,
    Guid CallerUserId,
    string ClientAppVersion,
    string AuditDeviceId,
    string AuditIpHash);

/// <summary>What the phone needs back: the row, never the file.</summary>
public sealed record PictureDto(
    Guid Id,
    string Kind,
    Guid SubjectId,
    string Sha256,
    string ContentType,
    int Bytes,
    DateTime SetAtUtc)
{
    public static PictureDto Of(Picture picture) => new(
        picture.Id, PictureKinds.ToWire(picture.Kind), picture.SubjectId, picture.Sha256, picture.ContentType, picture.Bytes, picture.SetAtUtc);
}

public sealed class SetPictureHandler(
    IShramSafalRepository repository,
    IPictureStore store,
    IAttachmentStorageService storage,
    IClock clock,
    ILogger<SetPictureHandler> logger,
    IEntitlementResolver? entitlements = null)
{
    public async Task<Result<PictureDto>> HandleAsync(SetPictureCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty || command.Content is null)
        {
            return Result.Failure<PictureDto>(ShramSafalErrors.InvalidCommand);
        }

        // The cheap, caller-independent checks first: a refused file never reads a row.
        var bytes = await ReadBoundedAsync(command.Content, ct);
        if (bytes.Length == 0)
        {
            return Result.Failure<PictureDto>(ShramSafalErrors.PictureEmpty);
        }

        if (bytes.Length > PictureRules.MaxBytes)
        {
            return Result.Failure<PictureDto>(ShramSafalErrors.PictureTooLarge);
        }

        if (PictureRules.DetectContentType(bytes.AsSpan(0, Math.Min(bytes.Length, PictureRules.HeaderBytes))) is not { } contentType)
        {
            return Result.Failure<PictureDto>(ShramSafalErrors.PictureUnsupportedType);
        }

        var subject = await PictureSubject.ResolveAsync(command.Kind, command.RouteId, command.CallerUserId, repository, entitlements, ct);
        if (!subject.IsSuccess)
        {
            return Result.Failure<PictureDto>(subject.Error);
        }

        var (subjectId, actorRole) = subject.Value;
        var sha256 = PictureRules.Sha256Hex(bytes);
        var existing = await store.GetAsync(command.Kind, subjectId, ct);
        if (existing is not null && existing.Sha256 == sha256)
        {
            // The same file again: nothing changes (no new file, no new audit row).
            return Result.Success(PictureDto.Of(existing));
        }

        var nowUtc = clock.UtcNow;
        var key = PictureRules.StorageKeyFor(command.Kind, subjectId, sha256);

        // The file goes first: a row never points at a file that is not there. A leftover file at this key (an earlier request that
        // died before its row was saved) is cleared first - the local store creates new files only. Best effort: S3 overwrites anyway, and a
        // deployment whose role may not delete must still be able to SET a picture (it then keeps only the unreferenced files of replaced ones).
        await TryDeleteAsync(storage, key, logger);
        await using (var copy = new MemoryStream(bytes, writable: false))
        {
            await storage.SaveAsync(key, copy, contentType, ct);
        }

        string? previousKey = null;
        Picture picture;
        if (existing is null)
        {
            picture = Picture.Create(Guid.NewGuid(), command.Kind, subjectId, contentType, bytes.Length, sha256, new UserId(command.CallerUserId), nowUtc);
            store.Stage(picture);
        }
        else
        {
            picture = existing;
            previousKey = existing.StorageKey;
            picture.Replace(contentType, bytes.Length, sha256, new UserId(command.CallerUserId), nowUtc);
        }

        // Provenance as the attachment upload carries it. The payload names the kind, the subject, the size and the hash: never the image.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Picture",
                entityId: picture.Id,
                action: "PictureSet",
                actorUserId: command.CallerUserId,
                actorRole: actorRole,
                payload: new
                {
                    kind = PictureKinds.ToWire(command.Kind),
                    subjectId,
                    bytes = bytes.Length,
                    sha256,
                    replaced = previousKey is not null,
                },
                farmId: null,
                clientCommandId: null,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        // The replaced file goes after the row that no longer names it. A failure to delete leaves an unreferenced file (never a row
        // pointing at nothing); it is not worth failing a save that has happened.
        if (previousKey is not null && previousKey != key)
        {
            await TryDeleteAsync(storage, previousKey, logger);
        }

        return Result.Success(PictureDto.Of(picture));
    }

    /// <summary>Reads at most <see cref="PictureRules.MaxBytes"/> + 1 bytes: enough to tell "too large" without buffering a huge body.</summary>
    internal static async Task<byte[]> ReadBoundedAsync(Stream content, CancellationToken ct)
    {
        await using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        while (buffer.Length <= PictureRules.MaxBytes)
        {
            var wanted = (int)Math.Min(chunk.Length, PictureRules.MaxBytes + 1 - buffer.Length);
            var read = await content.ReadAsync(chunk.AsMemory(0, wanted), ct);
            if (read == 0)
            {
                break;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    internal static async Task TryDeleteAsync(IAttachmentStorageService storage, string key, ILogger logger)
    {
        try
        {
            await storage.DeleteAsync(key, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // Deliberately not rethrown: see the callers. The file stays unreferenced; nothing reads it (no row names its key).
            logger.LogWarning(ex, "A picture file could not be deleted and is left unreferenced in storage (key {StorageKey}).", key);
        }
    }
}
