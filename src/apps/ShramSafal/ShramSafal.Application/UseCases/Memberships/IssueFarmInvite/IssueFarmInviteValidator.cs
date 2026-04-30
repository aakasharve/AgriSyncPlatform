using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

/// <summary>
/// Sub-plan 03 Task 8: validation moves OUT of the handler and into a
/// pipeline behavior input. The handler's <c>HandleAsync</c> body now
/// trusts that <see cref="IssueFarmInviteCommand.FarmId"/> and
/// <see cref="IssueFarmInviteCommand.CallerUserId"/> are non-empty —
/// the <see cref="ValidationBehavior{TCommand,TResult}"/> short-
/// circuits before the handler is invoked when this validator yields
/// any error.
/// </summary>
public sealed class IssueFarmInviteValidator : IValidator<IssueFarmInviteCommand>
{
    public IEnumerable<Error> Validate(IssueFarmInviteCommand command)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
