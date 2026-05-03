using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Attachments.UploadAttachment;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (UploadAttachment): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Empty <see cref="UploadAttachmentCommand.AttachmentId"/>.</item>
/// <item>Empty <see cref="UploadAttachmentCommand.UploadedByUserId"/>.</item>
/// <item>Null <see cref="UploadAttachmentCommand.FileStream"/>
/// (presence-only — the validator does NOT read the stream; the
/// stream's content is binary upload data and reading it here would
/// either consume bytes the body needs or block the pipeline on a
/// network read).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and aggregate
/// rules:
/// <list type="bullet">
/// <item>Attachment existence (extracted into
/// <see cref="UploadAttachmentAuthorizer"/>).</item>
/// <item>Farm-membership (extracted).</item>
/// <item>State guard:
/// <see cref="ShramSafalErrors.AttachmentAlreadyFinalized"/> — that's
/// an aggregate-state precondition on the loaded attachment, not a
/// command-shape gate.</item>
/// <item>Mime-type matching against the reserved
/// <see cref="Domain.Attachments.Attachment.MimeType"/> — needs the
/// loaded aggregate.</item>
/// <item>Stream save + finalize.</item>
/// </list>
/// </para>
/// </summary>
public sealed class UploadAttachmentValidator : IValidator<UploadAttachmentCommand>
{
    public IEnumerable<Error> Validate(UploadAttachmentCommand command)
    {
        if (command.AttachmentId == Guid.Empty
            || command.UploadedByUserId == Guid.Empty
            || command.FileStream is null)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
