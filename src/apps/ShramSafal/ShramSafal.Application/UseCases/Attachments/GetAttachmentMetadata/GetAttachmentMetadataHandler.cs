using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;

public sealed class GetAttachmentMetadataHandler(IShramSafalRepository repository)
{
    public async Task<Result<AttachmentDto>> HandleAsync(GetAttachmentMetadataQuery query, CancellationToken ct = default)
    {
        if (query.AttachmentId == Guid.Empty || query.RequestedByUserId == Guid.Empty)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.InvalidCommand);
        }

        var attachment = await repository.GetAttachmentByIdAsync(query.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.AttachmentNotFound);
        }

        var canReadFarm = await repository.IsUserMemberOfFarmAsync(attachment.FarmId, query.RequestedByUserId, ct);
        if (!canReadFarm)
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.Forbidden);
        }

        return Result.Success(attachment.ToDto());
    }
}
