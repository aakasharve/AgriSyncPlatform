using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.GetAttachment;

public sealed class GetAttachmentHandler(
    IShramSafalRepository repository,
    IAuthorizationEnforcer authorizationEnforcer)
{
    public async Task<Result<AttachmentDto>> HandleAsync(GetAttachmentQuery query, CancellationToken ct = default)
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

        await authorizationEnforcer.EnsureIsFarmMember(new UserId(query.RequestedByUserId), attachment.FarmId);
        return Result.Success(attachment.ToDto());
    }
}
