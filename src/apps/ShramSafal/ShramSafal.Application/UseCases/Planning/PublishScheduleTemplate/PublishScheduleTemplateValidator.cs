using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (PublishScheduleTemplate): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate yielding <see cref="ShramSafalErrors.InvalidCommand"/>:
/// either <see cref="PublishScheduleTemplateCommand.TemplateId"/> or
/// <see cref="PublishScheduleTemplateCommand.CallerUserId"/> is empty.
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// idempotency lookup, template existence (extracted into
/// <see cref="PublishScheduleTemplateAuthorizer"/>), author-only +
/// per-scope role gate (also extracted), domain Publish() invariants
/// (e.g. already-published guard), audit, save.
/// </para>
/// </summary>
public sealed class PublishScheduleTemplateValidator : IValidator<PublishScheduleTemplateCommand>
{
    public IEnumerable<Error> Validate(PublishScheduleTemplateCommand command)
    {
        if (command.TemplateId == Guid.Empty
            || command.CallerUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
