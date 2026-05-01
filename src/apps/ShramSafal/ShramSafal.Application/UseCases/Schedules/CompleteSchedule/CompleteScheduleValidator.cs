using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Schedules.CompleteSchedule;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CompleteSchedule): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Single gate yielding <see cref="ShramSafalErrors.InvalidCommand"/>:
/// any of the four required IDs (FarmId / PlotId / CropCycleId /
/// ActorUserId) is empty.
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// farm + plot + cropCycle existence (extracted into
/// <see cref="CompleteScheduleAuthorizer"/>), entitlement gate, prior-
/// active subscription lookup, state transition, audit, save, analytics.
/// </para>
/// </summary>
public sealed class CompleteScheduleValidator : IValidator<CompleteScheduleCommand>
{
    public IEnumerable<Error> Validate(CompleteScheduleCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || command.ActorUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
