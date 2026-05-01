using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Schedules.AdoptSchedule;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AdoptSchedule): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two gates extracted, both yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item>Any of the five required IDs is empty
/// (FarmId / PlotId / CropCycleId / ScheduleTemplateId / ActorUserId).</item>
/// <item>An explicit <see cref="AdoptScheduleCommand.SubscriptionId"/>
/// was supplied but is empty (null is fine — handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns I/O-bound invariants and domain rules:
/// farm + plot + cropCycle existence and cross-aggregate cohesion (also
/// extracted into <see cref="AdoptScheduleAuthorizer"/>), entitlement
/// gate, schedule-template publication and crop-key match, single-active
/// invariant I-14, audit, save. Endpoint
/// (POST /plots/{plotId}/cycles/{cycleId}/schedule/adopt) gets the
/// canonical <c>InvalidCommand → FarmNotFound → PlotNotFound →
/// CropCycleNotFound → Forbidden</c> ordering through the pipeline.
/// </para>
/// </summary>
public sealed class AdoptScheduleValidator : IValidator<AdoptScheduleCommand>
{
    public IEnumerable<Error> Validate(AdoptScheduleCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.PlotId == Guid.Empty
            || command.CropCycleId == Guid.Empty
            || command.ScheduleTemplateId == Guid.Empty
            || command.ActorUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.SubscriptionId.HasValue && command.SubscriptionId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
