using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

/// <summary>
/// Sub-plan 03 Task 8: ownership check moves OUT of the handler and
/// into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage. Delegates to
/// <see cref="IAuthorizationEnforcer.EnsureIsOwner"/> which now (per
/// T-IGH-03-AUTHZ-RESULT) returns <see cref="Result"/> directly —
/// the previous try/catch seam that translated
/// <see cref="UnauthorizedAccessException"/> to <c>Result.Failure</c>
/// was removed when the enforcer adopted the Result-based contract.
/// </summary>
public sealed class IssueFarmInviteAuthorizer : IAuthorizationCheck<IssueFarmInviteCommand>
{
    private readonly IAuthorizationEnforcer _authz;

    public IssueFarmInviteAuthorizer(IAuthorizationEnforcer authz)
    {
        _authz = authz;
    }

    public Task<Result> AuthorizeAsync(IssueFarmInviteCommand command, CancellationToken ct)
        => _authz.EnsureIsOwner(command.CallerUserId, command.FarmId);
}
