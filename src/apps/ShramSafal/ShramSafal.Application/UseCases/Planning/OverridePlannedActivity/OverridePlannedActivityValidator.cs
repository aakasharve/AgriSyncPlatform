using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (OverridePlannedActivity): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// Four caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="OverridePlannedActivityCommand.PlannedActivityId"/> empty.</item>
/// <item><see cref="OverridePlannedActivityCommand.FarmId"/> empty.</item>
/// <item><see cref="OverridePlannedActivityCommand.CallerUserId"/> empty.</item>
/// <item><see cref="OverridePlannedActivityCommand.Reason"/> blank.</item>
/// </list>
/// The reason gate is a caller-shape rule because override semantics
/// require an audit trail; a blank reason is meaningless input regardless
/// of who is calling or what the planned activity looks like.
/// </para>
///
/// <para>
/// The handler body still owns idempotency, planned-activity load
/// (PlannedActivityNotFound + IsRemoved short-circuit), the domain
/// invariant in <see cref="ShramSafal.Domain.Planning.PlannedActivity.Override"/>,
/// audit, save. The endpoint
/// (POST /planned-activities/{id}/override) gets the canonical
/// <c>InvalidCommand → PlannedActivityNotFound → Forbidden → (body)</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class OverridePlannedActivityValidator : IValidator<OverridePlannedActivityCommand>
{
    public IEnumerable<Error> Validate(OverridePlannedActivityCommand command)
    {
        if (command.PlannedActivityId == Guid.Empty
            || command.FarmId == Guid.Empty
            || command.CallerUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Reason))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
