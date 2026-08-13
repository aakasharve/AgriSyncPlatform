using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — owner-only, through the EXISTING enforcer, exactly as
/// <c>IssueFarmInviteAuthorizer</c> does for the other owner-only farm-access
/// action.
///
/// <para><b>This stage does two jobs, and the second one is easy to miss.</b>
/// Besides answering "is the caller an owner", <c>EnsureIsOwner</c> publishes the
/// resolved <c>(farmId, ownerAccountId)</c> into the per-request
/// <c>TenantContext</c> — which is what makes <c>TenantConnectionInterceptor</c>
/// stamp <c>agrisync.farm_id</c> on every subsequent command, and therefore what
/// scopes <c>p_tenant_farm_memberships</c> for the handler's reads and its write.
/// Removing this authorizer would not merely un-gate the endpoint; it would leave
/// the handler with no tenant claim at all and the interceptor would fail
/// closed.</para>
///
/// <para>The handler re-checks ownership anyway. That is not redundancy for its
/// own sake: it is what keeps the rule true on any future non-HTTP entry point,
/// the same posture every labour handler takes.</para>
/// </summary>
public sealed class SetLabourPermissionAuthorizer(IAuthorizationEnforcer authz)
    : IAuthorizationCheck<SetLabourPermissionCommand>
{
    public Task<Result> AuthorizeAsync(SetLabourPermissionCommand command, CancellationToken ct)
        => authz.EnsureIsOwner(command.CallerUserId, command.FarmId);
}
