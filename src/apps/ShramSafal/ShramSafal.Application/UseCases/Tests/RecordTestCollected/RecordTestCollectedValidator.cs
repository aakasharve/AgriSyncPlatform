using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Tests.RecordTestCollected;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RecordTestCollected): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate: empty <see cref="RecordTestCollectedCommand.TestInstanceId"/>
/// or empty <see cref="RecordTestCollectedCommand.CallerUserId"/> →
/// <see cref="ShramSafalErrors.InvalidCommand"/>.
/// </para>
///
/// <para>
/// The handler body still owns the role-based authorization (extracted
/// into <see cref="RecordTestCollectedAuthorizer"/>), test-instance
/// existence (TestInstanceNotFound), domain-state guard (TestInvalidState
/// when the aggregate refuses the transition), audit, save.
/// </para>
/// </summary>
public sealed class RecordTestCollectedValidator : IValidator<RecordTestCollectedCommand>
{
    public IEnumerable<Error> Validate(RecordTestCollectedCommand command)
    {
        if (command is null
            || command.TestInstanceId == Guid.Empty
            || command.CallerUserId.IsEmpty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
