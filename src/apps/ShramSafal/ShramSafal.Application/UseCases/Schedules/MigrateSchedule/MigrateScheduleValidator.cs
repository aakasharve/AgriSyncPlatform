using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Schedules.MigrateSchedule;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (MigrateSchedule): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Any of the five required IDs is empty
/// (FarmId / PlotId / CropCycleId / NewScheduleTemplateId / ActorUserId).</item>
/// <item>An explicit <see cref="MigrateScheduleCommand.NewSubscriptionId"/>
/// or <see cref="MigrateScheduleCommand.MigrationEventId"/> was supplied
/// but is empty (null is fine — handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// farm + plot + cropCycle existence (extracted into
/// <see cref="MigrateScheduleAuthorizer"/>), entitlement gate, schedule-
/// template publication and crop-key match, prior-active subscription
/// lookup, atomic migration state transition, audit, save, analytics.
/// </para>
/// </summary>
public sealed class MigrateScheduleValidator : IValidator<MigrateScheduleCommand>
{
    public IEnumerable<Error> Validate(MigrateScheduleCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || command.NewScheduleTemplateId == Guid.Empty
            || command.ActorUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if ((command.NewSubscriptionId.HasValue && command.NewSubscriptionId.Value == Guid.Empty)
            || (command.MigrationEventId.HasValue && command.MigrationEventId.Value == Guid.Empty))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
