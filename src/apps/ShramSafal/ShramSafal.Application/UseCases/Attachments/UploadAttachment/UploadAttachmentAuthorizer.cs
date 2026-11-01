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

        // spec: plr-d10 lane PRV fix pass 1 (H2) — no file is put into a photo of a record (or a bill) kept from him.
        var visibility = await Services.RecordVisibility.ForFarmAsync(
            _repository, (Guid)attachment.FarmId, command.UploadedByUserId, DateTime.UtcNow, ct);
        // Fix pass 3 (item 7) — the bytes of a photo whose row HE made always reach the server: he took it, the row is
        // already there, and the answer is his own photo's row (nothing of the record it hangs from). Without this, a
        // photo he added before its record was kept from him could never finish, and his phone would hold that record
        // for ever. Once it is up, the record (and the photo) leave his phone at the next sync like any withdrawn record.
        var tookIt = attachment.CreatedByUserId.Value == command.UploadedByUserId;
        if (!tookIt && !visibility.MaySeeAttachment(attachment))
        {
            return Result.Failure(ShramSafalErrors.RecordAudienceClosed);
        }

        return Result.Success();
    }
}
