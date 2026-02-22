using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;

public sealed class GetAttachmentFileHandler(
    IShramSafalRepository repository,
    IAttachmentStorageService attachmentStorageService,
    IAuthorizationEnforcer authorizationEnforcer)
{
    public async Task<Result<AttachmentFilePayload>> HandleAsync(GetAttachmentFileQuery query, CancellationToken ct = default)
    {
        if (query.AttachmentId == Guid.Empty || query.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<AttachmentFilePayload>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(query.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<AttachmentFilePayload>(ShramSafalErrors.AttachmentNotFound);
        }

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(query.RequestedByUserId), attachment.FarmId);

        if (attachment.Status != AttachmentStatus.Finalized)
        {
            return Result.Failure<AttachmentFilePayload>(ShramSafalErrors.AttachmentNotFinalized);
        }

        if (string.IsNullOrWhiteSpace(attachment.StoragePath))
        {
            return Result.Failure<AttachmentFilePayload>(ShramSafalErrors.AttachmentFileMissing);
        }

        var exists = await attachmentStorageService.ExistsAsync(attachment.StoragePath, ct);
        if (!exists)
        {
            return Result.Failure<AttachmentFilePayload>(ShramSafalErrors.AttachmentFileMissing);
        }

        var fileStream = await attachmentStorageService.RetrieveFileAsync(attachment.StoragePath, ct);
        return Result.Success(new AttachmentFilePayload(
            fileStream,
            attachment.OriginalFileName,
            attachment.MimeType));
    }
}

public sealed record AttachmentFilePayload(Stream FileStream, string FileName, string MimeType);
