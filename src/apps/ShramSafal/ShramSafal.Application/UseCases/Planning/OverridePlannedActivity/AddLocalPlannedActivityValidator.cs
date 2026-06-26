using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLocalPlannedActivity): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand}"/> pipeline stage.
///
/// <para>
/// Seven caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="AddLocalPlannedActivityCommand.NewActivityId"/> empty.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.CropCycleId"/> empty.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.FarmId"/> empty.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.CallerUserId"/> empty.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.ActivityName"/> blank.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.Stage"/> blank.</item>
/// <item><see cref="AddLocalPlannedActivityCommand.Reason"/> blank.</item>
/// </list>
/// These mirror the handler body's Step 1 caller-shape guards verbatim.
/// </para>
///
/// <para>
/// Unlike OverridePlannedActivity / RemovePlannedActivity, the add use
/// case CREATES a planned activity rather than loading an existing one,
/// so there is no PlannedActivityNotFound stage. The canonical pipeline
/// ordering for the endpoint (POST /planned-activities) is therefore
/// <c>InvalidCommand → Forbidden → (body)</c>.
/// </para>
/// </summary>
public sealed class AddLocalPlannedActivityValidator : IValidator<AddLocalPlannedActivityCommand>
{
    public IEnumerable<Error> Validate(AddLocalPlannedActivityCommand command)
    {
        if (command.NewActivityId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || command.FarmId == Guid.Empty
            || command.CallerUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.ActivityName)
            || string.IsNullOrWhiteSpace(command.Stage)
            || string.IsNullOrWhiteSpace(command.Reason))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
