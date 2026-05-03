using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyJobCardForPayout): caller-shape
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="VerifyJobCardForPayoutCommand.JobCardId"/> is empty.</item>
/// <item><see cref="VerifyJobCardForPayoutCommand.CallerUserId"/> is empty.</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body (all I/O-state-bound or
/// aggregate-state-bound):
/// <list type="bullet">
/// <item>Job-card existence
/// (<see cref="ShramSafalErrors.JobCardNotFound"/>) — pre-empted by the
/// authorizer.</item>
/// <item>Linked-daily-log present
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>) — aggregate-
/// state check.</item>
/// <item>DailyLog existence
/// (<see cref="ShramSafalErrors.DailyLogNotFound"/>) — separate I/O
/// lookup.</item>
/// <item>Caller role tier
/// (<see cref="ShramSafalErrors.Forbidden"/> /
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) — pre-empted
/// by the authorizer.</item>
/// <item>CEI-I9: linked log must be Verified — surfaces as
/// <see cref="ShramSafalErrors.JobCardInvalidState"/> via the body's
/// <c>InvalidOperationException</c> catch.</item>
/// </list>
/// </para>
/// </summary>
public sealed class VerifyJobCardForPayoutValidator : IValidator<VerifyJobCardForPayoutCommand>
{
    public IEnumerable<Error> Validate(VerifyJobCardForPayoutCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
