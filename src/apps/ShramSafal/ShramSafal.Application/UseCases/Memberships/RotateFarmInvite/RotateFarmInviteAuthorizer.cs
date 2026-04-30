using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (RotateFarmInvite): owner-only check
/// moves OUT of the handler and into the
/// <see cref="AuthorizationBehavior{TCommand,TResult}"/> pipeline stage.
/// Delegates to <see cref="IAuthorizationEnforcer.EnsureIsOwner"/> which
/// returns <see cref="Result"/> directly (per T-IGH-03-AUTHZ-RESULT) — no
/// try/catch seam needed.
/// </summary>
public sealed class RotateFarmInviteAuthorizer : IAuthorizationCheck<RotateFarmInviteCommand>
{
    private readonly IAuthorizationEnforcer _authz;

    public RotateFarmInviteAuthorizer(IAuthorizationEnforcer authz)
    {
        _authz = authz;
    }

    public Task<Result> AuthorizeAsync(RotateFarmInviteCommand command, CancellationToken ct)
        => _authz.EnsureIsOwner(command.CallerUserId, command.FarmId);
}
