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
/// Caller-shape gates extracted, all yielding
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
/// The activity-name / stage / reason gates are caller-shape rules
/// because the domain factory <c>CreateLocallyAdded</c> throws on these
/// — surfacing them as <c>InvalidCommand</c> here gives a uniform
/// Result-typed failure path before any I/O runs.
/// </para>
///
/// <para>
/// The handler body still owns idempotency, role lookup (now redundant
/// with the authorizer but preserved as defense-in-depth for direct
/// callers), domain construction, persistence, audit, and save. The
/// endpoint (POST /planned-activities) gets the canonical
/// <c>InvalidCommand → Forbidden → (body)</c> ordering through the
/// pipeline. There is intentionally no <c>NotFound</c> stage on this
/// command — there is no pre-existing aggregate to load; the command
/// CREATES a new <see cref="ShramSafal.Domain.Planning.PlannedActivity"/>.
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
