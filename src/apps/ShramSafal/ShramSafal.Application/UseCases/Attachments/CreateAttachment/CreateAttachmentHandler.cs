using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.CreateAttachment;

public sealed class CreateAttachmentHandler(
    IShramSafalRepository repository,
    IAuthorizationEnforcer authorizationEnforcer,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<CreateAttachmentResult>> HandleAsync(CreateAttachmentCommand command, CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.UploadedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.OriginalFileName) ||
            string.IsNullOrWhiteSpace(command.MimeType) ||
            command.SizeBytes <= 0)
        {
            return Result.Failure<CreateAttachmentResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.AttachmentId.HasValue && command.AttachmentId.Value == Guid.Empty)
        {
            return Result.Failure<CreateAttachmentResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.LinkedEntityId.HasValue ^ !string.IsNullOrWhiteSpace(command.LinkedEntityType))
        {
            return Result.Failure<CreateAttachmentResult>(ShramSafalErrors.InvalidAttachmentLink);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<CreateAttachmentResult>(ShramSafalErrors.FarmNotFound);
        }

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(command.UploadedByUserId), new FarmId(command.FarmId));

        var normalizedLinkedEntityType = command.LinkedEntityType is null
            ? null
            : NormalizeLinkedEntityType(command.LinkedEntityType);

        if (command.LinkedEntityId.HasValue && normalizedLinkedEntityType is null)
        {
            return Result.Failure<CreateAttachmentResult>(ShramSafalErrors.InvalidAttachmentLink);
        }

        if (command.LinkedEntityId.HasValue && normalizedLinkedEntityType is not null)
        {
            var linkValidation = await ValidateLinkTargetAsync(
                command.FarmId,
                command.LinkedEntityId.Value,
                normalizedLinkedEntityType,
                ct);

            if (!linkValidation.IsSuccess)
            {
                return Result.Failure<CreateAttachmentResult>(linkValidation.Error);
            }
        }

        var attachmentId = command.AttachmentId ?? idGenerator.New();
        var createdAtUtc = clock.UtcNow;
        var storagePath = BuildStoragePath(command.FarmId, attachmentId, command.OriginalFileName, createdAtUtc);

        var attachment = Domain.Attachments.Attachment.Create(
            attachmentId,
            command.FarmId,
            command.UploadedByUserId,
            command.OriginalFileName,
            command.MimeType,
            command.SizeBytes,
            storagePath,
            createdAtUtc);

        if (command.LinkedEntityId.HasValue && normalizedLinkedEntityType is not null)
        {
            attachment.LinkToEntity(command.LinkedEntityId.Value, normalizedLinkedEntityType);
        }

        await repository.AddAttachmentAsync(attachment, ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(new CreateAttachmentResult(
            attachment.ToDto(),
            $"/shramsafal/attachments/{attachment.Id}/upload"));
    }

    private async Task<Result> ValidateLinkTargetAsync(
        Guid farmId,
        Guid linkedEntityId,
        string linkedEntityType,
        CancellationToken ct)
    {
        if (linkedEntityType.Equals("DailyLog", StringComparison.Ordinal))
        {
            var log = await repository.GetDailyLogByIdAsync(linkedEntityId, ct);
            if (log is null || log.FarmId != new FarmId(farmId))
            {
                return Result.Failure(ShramSafalErrors.InvalidAttachmentLink);
            }

            return Result.Success();
        }

        if (linkedEntityType.Equals("CostEntry", StringComparison.Ordinal))
        {
            var costEntry = await repository.GetCostEntryByIdAsync(linkedEntityId, ct);
            if (costEntry is null || costEntry.FarmId != new FarmId(farmId))
            {
                return Result.Failure(ShramSafalErrors.InvalidAttachmentLink);
            }

            return Result.Success();
        }

        return Result.Failure(ShramSafalErrors.InvalidAttachmentLink);
    }

    private static string? NormalizeLinkedEntityType(string linkedEntityType)
    {
        var normalized = linkedEntityType.Trim();
        if (normalized.Equals("DailyLog", StringComparison.OrdinalIgnoreCase))
        {
            return "DailyLog";
        }

        if (normalized.Equals("CostEntry", StringComparison.OrdinalIgnoreCase))
        {
            return "CostEntry";
        }

        return null;
    }

    private static string BuildStoragePath(Guid farmId, Guid attachmentId, string originalFileName, DateTime createdAtUtc)
    {
        var extension = Path.GetExtension(originalFileName);
        if (string.IsNullOrWhiteSpace(extension))
        {
            extension = ".bin";
        }

        var baseName = Path.GetFileNameWithoutExtension(originalFileName);
        if (string.IsNullOrWhiteSpace(baseName))
        {
            baseName = "file";
        }

        var safeBaseName = new string(baseName
            .Select(character => Path.GetInvalidFileNameChars().Contains(character) ? '_' : character)
            .ToArray())
            .Trim();

        if (safeBaseName.Length == 0)
        {
            safeBaseName = "file";
        }

        if (safeBaseName.Length > 80)
        {
            safeBaseName = safeBaseName[..80];
        }

        var safeFileName = $"{attachmentId:N}_{safeBaseName}{extension}";
        return $"attachments/{farmId}/{createdAtUtc:yyyy-MM}/{safeFileName}";
    }
}

public sealed record CreateAttachmentResult(AttachmentDto Attachment, string UploadUrl);
