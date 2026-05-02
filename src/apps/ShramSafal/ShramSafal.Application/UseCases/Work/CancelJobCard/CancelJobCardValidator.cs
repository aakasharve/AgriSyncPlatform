using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CancelJobCard;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): caller-shape + reason
/// validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Three caller-shape gates extracted, all yielding
/// <see cref="ShramSafalErrors.InvalidCommand"/>:
/// <list type="number">
/// <item><see cref="CancelJobCardCommand.JobCardId"/> is empty.</item>
/// <item><see cref="CancelJobCardCommand.CallerUserId"/> is empty.</item>
/// <item><see cref="CancelJobCardCommand.Reason"/> is null/whitespace
/// (extracted verbatim from the body's first guard).</item>
/// </list>
/// </para>
///
/// <para>
/// Substantive checks remain in the body:
/// <list type="bullet">
/// <item>Job-card existence (<see cref="ShramSafalErrors.JobCardNotFound"/>)
/// — also pre-empted by the authorizer for the canonical pipeline path.</item>
/// <item>Caller role resolution + role/state gates (Forbidden,
/// JobCardInvalidState, JobCardRoleNotAllowed) — these are I/O-state-bound
/// and can't be expressed against the command alone.</item>
/// </list>
/// </para>
/// </summary>
public sealed class CancelJobCardValidator : IValidator<CancelJobCardCommand>
{
    public IEnumerable<Error> Validate(CancelJobCardCommand command)
    {
        if (command.JobCardId == Guid.Empty
            || command.CallerUserId.Value == Guid.Empty
            || string.IsNullOrWhiteSpace(command.Reason))
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
