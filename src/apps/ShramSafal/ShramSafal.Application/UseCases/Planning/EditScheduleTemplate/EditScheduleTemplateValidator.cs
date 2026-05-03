using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (EditScheduleTemplate): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate yielding <see cref="ShramSafalErrors.InvalidCommand"/>:
/// any of <see cref="EditScheduleTemplateCommand.SourceTemplateId"/>,
/// <see cref="EditScheduleTemplateCommand.NewTemplateId"/>, or
/// <see cref="EditScheduleTemplateCommand.CallerUserId"/> is empty.
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// idempotency lookup, source-template existence (extracted into
/// <see cref="EditScheduleTemplateAuthorizer"/>), Private-author /
/// per-scope role gate (also extracted), domain EditCopyOnWrite()
/// invariants, audit, save.
/// </para>
/// </summary>
public sealed class EditScheduleTemplateValidator : IValidator<EditScheduleTemplateCommand>
{
    public IEnumerable<Error> Validate(EditScheduleTemplateCommand command)
    {
        if (command.SourceTemplateId == Guid.Empty
            || command.NewTemplateId == Guid.Empty
            || command.CallerUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
