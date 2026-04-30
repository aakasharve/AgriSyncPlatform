using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;

/// <summary>
/// Sub-plan 03 Task 8: ownership check moves OUT of the handler and
/// into the <see cref="AuthorizationBehavior{TCommand,TResult}"/>
/// pipeline stage. Wraps the legacy throw-based
/// <see cref="IAuthorizationEnforcer.EnsureIsOwner"/> in a
/// transition seam: if the enforcer throws
/// <see cref="UnauthorizedAccessException"/>, this method translates
/// it into <c>Result.Failure(ShramSafalErrors.Forbidden)</c>.
///
/// <para>
/// The deeper fix — making <see cref="IAuthorizationEnforcer"/> return
/// <see cref="Result"/> directly — is filed as
/// <c>T-IGH-03-AUTHZ-RESULT</c> (Task 12 pending task).
/// </para>
/// </summary>
public sealed class IssueFarmInviteAuthorizer : IAuthorizationCheck<IssueFarmInviteCommand>
{
    private readonly IAuthorizationEnforcer _authz;

    public IssueFarmInviteAuthorizer(IAuthorizationEnforcer authz)
    {
        _authz = authz;
    }

    public async Task<Result> AuthorizeAsync(IssueFarmInviteCommand command, CancellationToken ct)
    {
        try
        {
            await _authz.EnsureIsOwner(command.CallerUserId, command.FarmId);
            return Result.Success();
        }
        catch (UnauthorizedAccessException)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }
    }
}
