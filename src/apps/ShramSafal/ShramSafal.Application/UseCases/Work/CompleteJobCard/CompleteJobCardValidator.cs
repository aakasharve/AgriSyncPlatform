using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="CompleteJobCardCommand.JobCardId"/> is empty.</item>
/// <item><see cref="CompleteJobCardCommand.DailyLogId"/> is empty.</item>
/// <item><see cref="CompleteJobCardCommand.CallerUserId"/> is empty.</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns the substantive checks: job-card existence
/// (JobCardNotFound), daily-log existence (DailyLogNotFound), farm/plot
/// match (JobCardDailyLogMismatch), at-least-one-matching-activity
/// (JobCardActivityTypeMismatch), state transition (JobCardInvalidState),
/// audit, save. Those are I/O-state-bound and can't be expressed against
/// the command alone. The endpoint
/// (POST /job-cards/{id}/complete) gets the canonical
/// <c>InvalidCommand → Forbidden → JobCardNotFound → DailyLogNotFound →
/// JobCardDailyLogMismatch → JobCardActivityTypeMismatch →
/// JobCardInvalidState</c> ordering through the pipeline (Validator
/// fires first, then Authorizer's job-card-membership check, then the
/// body's substantive checks).
/// </para>
/// </summary>
public sealed class CompleteJobCardValidator : IValidator<CompleteJobCardCommand>
{
    public IEnumerable<Error> Validate(CompleteJobCardCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.DailyLogId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
