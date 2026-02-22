using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

public sealed class UploadAttachmentHandler(
    IShramSafalRepository repository,
    IAttachmentStorageService attachmentStorageService,
    IAuthorizationEnforcer authorizationEnforcer,
    IClock clock)
{
    public async Task<Result<AttachmentDto>> HandleAsync(UploadAttachmentCommand command, CancellationToken ct = default)
    {
        if (command.AttachmentId == Guid.Empty || command.UploadedByUserId == Guid.Empty || command.FileStream is null)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(command.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.AttachmentNotFound);
        }

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(command.UploadedByUserId), attachment.FarmId);

        if (attachment.Status == AttachmentStatus.Finalized)
        {
            return Result.Success(attachment.ToDto());
        }

        try
        {
            attachment.MarkUploading();

            if (command.FileStream.CanSeek)
            {
                command.FileStream.Seek(0, SeekOrigin.Begin);
            }

            var farmIdValue = attachment.FarmId.Value.ToString();
            var relativeFilePath = ResolveRelativeStoragePath(attachment.StoragePath, farmIdValue);

            var storagePath = await attachmentStorageService.StoreFileAsync(
                command.FileStream,
                farmIdValue,
                relativeFilePath,
                ct);

            attachment.SetStoragePath(storagePath);
            attachment.FinalizeUpload(clock.UtcNow);

            await repository.SaveChangesAsync(ct);
            return Result.Success(attachment.ToDto());
        }
        catch (Exception ex)
        {
            attachment.MarkFailed();
            await repository.SaveChangesAsync(ct);

            return Result.Failure<AttachmentDto>(
                new Error(
                    ShramSafalErrors.AttachmentUploadFailed.Code,
                    $"{ShramSafalErrors.AttachmentUploadFailed.Description} {ex.Message}"));
        }
    }

    private static string ResolveRelativeStoragePath(string storagePath, string farmId)
    {
        var normalizedStoragePath = storagePath?.Replace('\\', '/').Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalizedStoragePath))
        {
            return $"{DateTime.UtcNow:yyyy-MM}/{Guid.NewGuid():N}.bin";
        }

        var prefix = $"attachments/{farmId}/";
        if (!normalizedStoragePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return $"{DateTime.UtcNow:yyyy-MM}/{Path.GetFileName(normalizedStoragePath)}";
        }

        var relative = normalizedStoragePath[prefix.Length..];
        return relative;
    }
}
