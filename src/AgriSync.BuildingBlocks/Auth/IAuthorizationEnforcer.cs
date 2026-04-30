using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.BuildingBlocks.Auth;

/// <summary>
/// Sub-plan 03 Task 8 follow-up (T-IGH-03-AUTHZ-RESULT, 2026-05-01):
/// authorization checks return <see cref="Result"/> instead of throwing
/// <see cref="UnauthorizedAccessException"/>. Each method:
/// <list type="bullet">
/// <item>Returns <c>Result.Success()</c> when the caller is authorized.</item>
/// <item>Returns <c>Result.Failure(...)</c> with an <c>Error</c> tagged
/// <see cref="ErrorKind.Forbidden"/> (or <c>NotFound</c> when the
/// underlying resource is missing) when the caller is not.</item>
/// </list>
/// Pre-T-IGH-03-AUTHZ-RESULT, every method threw on failure and a
/// pipeline seam (<c>IssueFarmInviteAuthorizer</c>) translated the
/// throw to a typed Result. With this contract, callers route the
/// Result directly without try/catch.
/// </summary>
public interface IAuthorizationEnforcer
{
    Task<Result> EnsureIsFarmMember(UserId userId, FarmId farmId);
    Task<Result> EnsureIsOwner(UserId userId, FarmId farmId);
    Task<Result> EnsureCanVerify(UserId userId, Guid logId);
    Task<Result> EnsureCanEditLog(UserId userId, Guid logId);
}
