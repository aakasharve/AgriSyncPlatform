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
/// Four caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="RemovePlannedActivityCommand.PlannedActivityId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.FarmId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.CallerUserId"/> empty.</item>
/// <item><see cref="RemovePlannedActivityCommand.Reason"/> blank.</item>
/// </list>
/// These mirror the handler body's Step 1 caller-shape guards verbatim.
/// The reason gate is a caller-shape rule because removal semantics
/// require an audit trail; a blank reason is meaningless input regardless
/// of who is calling or what the planned activity looks like.
/// </para>
///
/// <para>
/// The handler body still owns idempotency, planned-activity load
/// (PlannedActivityNotFound), the soft-remove domain mutation, audit,
/// save. The endpoint (POST /planned-activities/{id}/remove) gets the
/// canonical <c>InvalidCommand → PlannedActivityNotFound → Forbidden →
/// (body)</c> ordering through the pipeline.
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
