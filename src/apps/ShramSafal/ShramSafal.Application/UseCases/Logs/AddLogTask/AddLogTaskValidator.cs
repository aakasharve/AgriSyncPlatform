using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AddLogTask): caller-shape validation moves
/// OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Four gates are extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="AddLogTaskCommand.DailyLogId"/> is empty.</item>
/// <item><see cref="AddLogTaskCommand.ActorUserId"/> is empty.</item>
/// <item><see cref="AddLogTaskCommand.ActivityType"/> is missing or
/// whitespace.</item>
/// <item>An explicit <see cref="AddLogTaskCommand.LogTaskId"/> was
/// supplied but is empty (null is fine — the handler generates one).</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns the deeper invariants that require I/O
/// or domain knowledge of <c>ExecutionStatus</c>: log lookup,
/// membership check (defense-in-depth), entitlement gate, crop cycle
/// lookup, deviation-reason policy (Skipped/Pending/Disputed must carry
/// a code; Completed must NOT carry one), audit emission, save. The
/// pipeline guarantees the canonical error ordering
/// <c>InvalidCommand → DailyLogNotFound → Forbidden</c> by running this
/// validator first, then <see cref="AddLogTaskAuthorizer"/>, then the
/// body.
/// </para>
/// </summary>
public sealed class AddLogTaskValidator : IValidator<AddLogTaskCommand>
{
    public IEnumerable<Error> Validate(AddLogTaskCommand command)
    {
        if (command.DailyLogId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.ActivityType))
        {
            yield return ShramSafalErrors.InvalidCommand;
            yield break;
        }

        if (command.LogTaskId.HasValue && command.LogTaskId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
