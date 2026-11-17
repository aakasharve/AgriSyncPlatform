using AgriSync.BuildingBlocks.Results;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Application.UseCases.Pictures;

public sealed record RemovePictureCommand(
    PictureKind Kind,
    Guid? RouteId,
    Guid CallerUserId,
    string ClientAppVersion,
    string AuditDeviceId,
    string AuditIpHash);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). Removes a picture (the phone then draws the letter
/// badge). The same authority as setting it (<see cref="PictureSubject"/>). Idempotent: removing what is not there succeeds and writes nothing.
/// Returns whether a picture was removed.
/// </summary>
public sealed class RemovePictureHandler(
    IShramSafalRepository repository,
    IPictureStore store,
    IAttachmentStorageService storage,
    ILogger<RemovePictureHandler> logger,
    IEntitlementResolver? entitlements = null)
{
    public async Task<Result<bool>> HandleAsync(RemovePictureCommand command, CancellationToken ct = default)
    {
        if (command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<bool>(ShramSafalErrors.InvalidCommand);
        }

        var subject = await PictureSubject.ResolveAsync(command.Kind, command.RouteId, command.CallerUserId, repository, entitlements, ct);
        if (!subject.IsSuccess)
        {
            return Result.Failure<bool>(subject.Error);
        }

        var (subjectId, actorRole) = subject.Value;
        var existing = await store.GetAsync(command.Kind, subjectId, ct);
        if (existing is null)
        {
            return Result.Success(false);
        }

        var key = existing.StorageKey;
        store.Remove(existing);
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Picture",
                entityId: existing.Id,
                action: "PictureRemoved",
                actorUserId: command.CallerUserId,
                actorRole: actorRole,
                payload: new
                {
                    kind = PictureKinds.ToWire(command.Kind),
                    subjectId,
                    bytes = existing.Bytes,
                    sha256 = existing.Sha256,
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

        // After the row is gone (see SetPictureHandler: an unreferenced file is never read).
        await SetPictureHandler.TryDeleteAsync(storage, key, logger);
        return Result.Success(true);
    }
}
