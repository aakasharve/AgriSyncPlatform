using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentFile;

public sealed class GetAttachmentFileHandler(
    IShramSafalRepository repository,
    IAttachmentStorageService storageService)
{
    public async Task<Result<GetAttachmentFileResult>> HandleAsync(GetAttachmentFileQuery query, CancellationToken ct = default)
    {
        if (query.AttachmentId == Guid.Empty || query.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<GetAttachmentFileResult>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(query.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<GetAttachmentFileResult>(ShramSafalErrors.AttachmentNotFound);
        }

        var canReadFarm = await repository.IsUserMemberOfFarmAsync(attachment.FarmId, query.RequestedByUserId, ct);
        if (!canReadFarm)
        {
            return Result.Failure<GetAttachmentFileResult>(ShramSafalErrors.Forbidden);
        }

        if (attachment.Status != AttachmentStatus.Finalized || string.IsNullOrWhiteSpace(attachment.LocalPath))
        {
            return Result.Failure<GetAttachmentFileResult>(ShramSafalErrors.InvalidCommand);
        }

        var stream = await storageService.OpenReadAsync(attachment.LocalPath, ct);
        if (stream is null)
        {
            return Result.Failure<GetAttachmentFileResult>(ShramSafalErrors.AttachmentNotFound);
        }

        return Result.Success(new GetAttachmentFileResult(
            attachment.Id,
            attachment.FileName,
            attachment.MimeType,
            stream));
    }
}

public sealed record GetAttachmentFileResult(
    Guid AttachmentId,
    string FileName,
    string MimeType,
    Stream ContentStream);
