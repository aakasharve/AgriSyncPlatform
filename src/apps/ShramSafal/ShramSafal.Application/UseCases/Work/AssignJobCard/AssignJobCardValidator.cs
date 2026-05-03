using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.AssignJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): caller-shape validation
/// moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="AssignJobCardCommand.JobCardId"/> is empty.</item>
/// <item><see cref="AssignJobCardCommand.WorkerUserId"/> is empty.</item>
/// <item><see cref="AssignJobCardCommand.CallerUserId"/> is empty.</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body (all I/O-state-bound):
/// <list type="bullet">
/// <item>Job-card existence
/// (<see cref="ShramSafalErrors.JobCardNotFound"/>) — pre-empted by the
/// authorizer for the canonical pipeline path.</item>
/// <item>Caller role tier (Mukadam-or-Owner)
/// (<see cref="ShramSafalErrors.Forbidden"/> /
/// <see cref="ShramSafalErrors.JobCardRoleNotAllowed"/>) — pre-empted
/// by the authorizer.</item>
/// <item>Worker membership lookup
/// (<see cref="ShramSafalErrors.JobCardWorkerNotMember"/>) — kept in
/// the body because it's a separate I/O lookup against the worker, not
/// the caller.</item>
/// <item>Domain state machine
/// (<see cref="ShramSafalErrors.JobCardInvalidState"/>).</item>
/// </list>
/// </para>
/// </summary>
public sealed class AssignJobCardValidator : IValidator<AssignJobCardCommand>
{
    public IEnumerable<Error> Validate(AssignJobCardCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.WorkerUserId.Value == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
