using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): caller-shape validation moves
/// OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three guards are extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="VerifyLogCommand.DailyLogId"/> is empty.</item>
/// <item><see cref="VerifyLogCommand.VerifiedByUserId"/> is empty.</item>
/// <item>An explicit <see cref="VerifyLogCommand.VerificationEventId"/>
/// was supplied but is empty (null is fine — the handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns: log lookup, defense-in-depth role
/// resolution, the entitlement gate, the verification state-machine
/// try/catch, audit emission, SaveChanges, the auto-verify job-card
/// hook, and analytics — none of those are caller-shape invariants.
/// </para>
/// </summary>
public sealed class VerifyLogValidator : IValidator<VerifyLogCommand>
{
    public IEnumerable<Error> Validate(VerifyLogCommand command)
    {
        if (command.DailyLogId == Guid.Empty || command.VerifiedByUserId == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
            // Stop on the most-significant ID gap — emitting more on
            // top would only churn the aggregated description.
            yield break;
        }

        if (command.VerificationEventId.HasValue && command.VerificationEventId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
