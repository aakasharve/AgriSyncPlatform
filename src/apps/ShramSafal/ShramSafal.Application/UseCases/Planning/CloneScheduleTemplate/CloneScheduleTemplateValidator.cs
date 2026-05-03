using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CloneScheduleTemplate): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate yielding <see cref="ShramSafalErrors.InvalidCommand"/>:
/// any of <see cref="CloneScheduleTemplateCommand.SourceTemplateId"/>,
/// <see cref="CloneScheduleTemplateCommand.NewTemplateId"/>, or
/// <see cref="CloneScheduleTemplateCommand.CallerUserId"/> is empty, or
/// <see cref="CloneScheduleTemplateCommand.Reason"/> is blank.
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// idempotency lookup, source-template existence (extracted into
/// <see cref="CloneScheduleTemplateAuthorizer"/>), per-scope role
/// gate (also extracted), domain Clone() invariants, audit, save.
/// </para>
/// </summary>
public sealed class CloneScheduleTemplateValidator : IValidator<CloneScheduleTemplateCommand>
{
    public IEnumerable<Error> Validate(CloneScheduleTemplateCommand command)
    {
        if (command.SourceTemplateId == Guid.Empty
            || command.NewTemplateId == Guid.Empty
            || command.CallerUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Reason))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
