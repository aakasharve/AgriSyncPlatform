using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

public sealed class CreateAttachmentHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<CreateAttachmentCommand, AttachmentDto>
{
    public async Task<Result<AttachmentDto>> HandleAsync(CreateAttachmentCommand command, CancellationToken ct = default)
    {
        var linkedEntityType = command.LinkedEntityType?.Trim();
        var normalizedEntityType = NormalizeLinkedEntityType(linkedEntityType);
        if (command.FarmId == Guid.Empty ||
            command.CreatedByUserId == Guid.Empty ||
            command.LinkedEntityId == Guid.Empty ||
            string.IsNullOrWhiteSpace(normalizedEntityType) ||
            string.IsNullOrWhiteSpace(command.FileName) ||
            string.IsNullOrWhiteSpace(command.MimeType))
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.InvalidCommand);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.CreatedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.Forbidden);
        }

        var linkCheck = await ValidateLinkTargetAsync(command.FarmId, command.LinkedEntityId, normalizedEntityType, ct);
        if (!linkCheck.IsSuccess)
        {
            return Result.Failure<AttachmentDto>(linkCheck.Error);
        }

        var attachment = Domain.Attachments.Attachment.Create(
            command.AttachmentId ?? idGenerator.New(),
            new FarmId(command.FarmId),
            command.LinkedEntityId,
            normalizedEntityType,
            command.FileName,
            command.MimeType,
            new UserId(command.CreatedByUserId),
            clock.UtcNow);

        await repository.AddAttachmentAsync(attachment, ct);
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Attachment",
                entityId: attachment.Id,
                action: "Created",
                actorUserId: command.CreatedByUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    attachment.Id,
                    command.FarmId,
                    command.LinkedEntityId,
                    LinkedEntityType = normalizedEntityType,
                    command.FileName,
                    command.MimeType,
                    attachment.Status
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(attachment.ToDto());
    }

    private async Task<Result> ValidateLinkTargetAsync(
        Guid farmId,
        Guid linkedEntityId,
        string linkedEntityType,
        CancellationToken ct)
    {
        if (linkedEntityType.Equals("farm", StringComparison.OrdinalIgnoreCase))
        {
            var farm = await repository.GetFarmByIdAsync(linkedEntityId, ct);
            if (farm is null)
            {
                return Result.Failure(ShramSafalErrors.FarmNotFound);
            }

            return (Guid)farm.Id == farmId
                ? Result.Success()
                : Result.Failure(ShramSafalErrors.Forbidden);
        }

        if (linkedEntityType.Equals("dailylog", StringComparison.OrdinalIgnoreCase))
        {
            var log = await repository.GetDailyLogByIdAsync(linkedEntityId, ct);
            if (log is null)
            {
                return Result.Failure(ShramSafalErrors.DailyLogNotFound);
            }

            return (Guid)log.FarmId == farmId
                ? Result.Success()
                : Result.Failure(ShramSafalErrors.Forbidden);
        }

        if (linkedEntityType.Equals("costentry", StringComparison.OrdinalIgnoreCase))
        {
            var entry = await repository.GetCostEntryByIdAsync(linkedEntityId, ct);
            if (entry is null)
            {
                return Result.Failure(ShramSafalErrors.CostEntryNotFound);
            }

            return (Guid)entry.FarmId == farmId
                ? Result.Success()
                : Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Failure(ShramSafalErrors.InvalidCommand);
    }

    private static string? NormalizeLinkedEntityType(string? linkedEntityType)
    {
        if (string.IsNullOrWhiteSpace(linkedEntityType))
        {
            return null;
        }

        return linkedEntityType.Trim().ToLowerInvariant() switch
        {
            "farm" => "Farm",
            "dailylog" => "DailyLog",
            "costentry" => "CostEntry",
            _ => null
        };
    }
}
