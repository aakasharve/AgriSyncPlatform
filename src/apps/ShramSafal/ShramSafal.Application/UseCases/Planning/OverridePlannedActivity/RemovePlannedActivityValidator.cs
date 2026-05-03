using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RemovePlannedActivity): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// Caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="RemovePlannedActivityCommand.PlannedActivityId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.FarmId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.CallerUserId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.Reason"/> blank
/// (audit-trail rule mirroring <c>SoftRemove</c>'s domain
/// invariant).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns idempotency, planned-activity load,
/// the domain invariant in
/// <see cref="ShramSafal.Domain.Planning.PlannedActivity.SoftRemove"/>,
/// audit, and save. The endpoint
/// (POST /planned-activities/{id}/remove) gets the canonical
/// <c>InvalidCommand → PlannedActivityNotFound → Forbidden → (body)</c>
/// ordering through the pipeline.
/// </para>
/// </summary>
public sealed class RemovePlannedActivityValidator : IValidator<RemovePlannedActivityCommand>
{
    public IEnumerable<Error> Validate(RemovePlannedActivityCommand command)
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
