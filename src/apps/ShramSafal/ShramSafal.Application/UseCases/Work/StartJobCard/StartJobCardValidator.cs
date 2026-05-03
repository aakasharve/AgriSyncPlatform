using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (StartJobCard): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Two caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="StartJobCardCommand.JobCardId"/> is empty.</item>
/// <item><see cref="StartJobCardCommand.CallerUserId"/> is empty.</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body (all I/O-state-bound or
/// aggregate-state-bound):
/// <list type="bullet">
/// <item>Job-card existence
/// (<see cref="ShramSafalErrors.JobCardNotFound"/>) — pre-empted by
/// the authorizer for the canonical pipeline path.</item>
/// <item>Same-timestamp idempotency (caller is the assigned worker AND
/// the job card is already started) — kept in the body because it
/// hinges on the aggregate's <c>StartedAtUtc</c> snapshot.</item>
/// <item>Assigned-worker invariant + status transition
/// (<see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) — enforced
/// by <c>JobCard.Start</c> and surfaced through the body's
/// <c>InvalidOperationException</c> catch. Stays in the body because
/// "is this caller the assigned worker?" depends on the aggregate's
/// current state and is not expressible as a pure-command predicate.</item>
/// </list>
/// </para>
/// </summary>
public sealed class StartJobCardValidator : IValidator<StartJobCardCommand>
{
    public IEnumerable<Error> Validate(StartJobCardCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
