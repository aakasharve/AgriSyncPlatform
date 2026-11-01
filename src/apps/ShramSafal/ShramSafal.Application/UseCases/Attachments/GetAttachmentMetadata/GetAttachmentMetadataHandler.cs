using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.GetAttachmentMetadata;

/// <summary>One attachment's metadata. lane MU-3: read where its parent is read (<see cref="AttachmentParentRule"/>).</summary>
public sealed class GetAttachmentMetadataHandler(IShramSafalRepository repository, IClock? clock = null)
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
        if (!canReadFarm
            || !await AttachmentParentRule.MayReadAsync(
                repository, attachment, query.RequestedByUserId, clock?.UtcNow ?? DateTime.UtcNow, ct))
        {
            return Result.Failure<AttachmentDto>(ShramSafalErrors.Forbidden);
        }

        return Result.Success(attachment.ToDto());
    }
}
