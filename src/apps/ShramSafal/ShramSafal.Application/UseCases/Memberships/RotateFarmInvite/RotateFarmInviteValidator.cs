using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RotateFarmInvite): validation moves OUT of
/// the handler and into a pipeline-behavior input. Mirrors the
/// IssueFarmInvite POC — the handler's <c>HandleAsync</c> body trusts
/// that <see cref="RotateFarmInviteCommand.FarmId"/> and
/// <see cref="RotateFarmInviteCommand.CallerUserId"/> are non-empty
/// because the <see cref="ValidationBehavior{TCommand,TResult}"/>
/// short-circuits before the handler is invoked when this validator
/// yields any error.
/// </summary>
public sealed class RotateFarmInviteValidator : IValidator<RotateFarmInviteCommand>
{
    public IEnumerable<Error> Validate(RotateFarmInviteCommand command)
    {
        if (command.FarmId.IsEmpty || command.CallerUserId.IsEmpty)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }
}
