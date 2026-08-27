using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — owner-only, and the stage that publishes the tenant
/// claim this read is scoped by. See
/// <c>SetLabourPermissionAuthorizer</c> for the full note on why removing it
/// would break more than the gate.
/// </summary>
public sealed class GetLabourPermissionsAuthorizer(IAuthorizationEnforcer authz)
    : IAuthorizationCheck<GetLabourPermissionsQuery>
{
    public Task<Result> AuthorizeAsync(GetLabourPermissionsQuery query, CancellationToken ct)
        => authz.EnsureIsOwner(query.CallerUserId, query.FarmId);
}
