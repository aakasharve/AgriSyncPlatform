using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (UploadAttachment): attachment existence
/// + farm-membership authorization moves OUT of the handler body into
/// the <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline
/// stage.
///
/// <para>
/// Takes <see cref="IShramSafalRepository"/> directly — same shape as
/// <see cref="CreateAttachmentAuthorizer"/>; no
/// <c>IAuthorizationEnforcer</c> method matches "load attachment, then
/// check membership on its farm." The pre-fetch of the attachment here
/// is shared with the handler body via EF's first-level cache when the
/// pipeline-consumer path runs in the same DbContext scope.
/// </para>
///
/// <para>
/// Error contract (preserves the body's error ordering):
/// <list type="bullet">
/// <item><see cref="ShramSafalErrors.AttachmentNotFound"/> — attachment
/// id resolves to nothing.</item>
/// <item><see cref="ShramSafalErrors.Forbidden"/> — caller is not a
/// member of the attachment's farm.</item>
/// </list>
/// The aggregate-state guard
/// (<see cref="ShramSafalErrors.AttachmentAlreadyFinalized"/>) and
/// the mime-type matching check stay inline — both depend on the
/// loaded aggregate's state, not the command shape.
/// </para>
/// </summary>
public sealed class UploadAttachmentAuthorizer : IAuthorizationCheck<UploadAttachmentCommand>
{
    private readonly IShramSafalRepository _repository;

    public UploadAttachmentAuthorizer(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<Result> AuthorizeAsync(UploadAttachmentCommand command, CancellationToken ct)
    {
        var attachment = await _repository.GetAttachmentByIdAsync(command.AttachmentId, ct);
        if (attachment is null)
        {
            return Result.Failure(ShramSafalErrors.AttachmentNotFound);
        }

        var isMember = await _repository.IsUserMemberOfFarmAsync(
            attachment.FarmId, command.UploadedByUserId, ct);
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        return Result.Success();
    }
}
