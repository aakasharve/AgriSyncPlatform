using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.UseCases.Memberships.ManageMembership;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — owner tier first, through the existing enforcer,
/// exactly as <c>SetLabourPermissionAuthorizer</c>: <c>EnsureIsOwner</c> is both a first gate and
/// what publishes the farm's tenant claim the handler's reads and write are scoped by. The handler
/// then narrows it to the PRIMARY owner (founder D-22, 26 Oct): a co-owner passes this check and is
/// refused there with the same 403.
/// </summary>
public sealed class ManageMembershipAuthorizer(IAuthorizationEnforcer authz)
    : IAuthorizationCheck<ManageMembershipCommand>
{
    public Task<Result> AuthorizeAsync(ManageMembershipCommand command, CancellationToken ct)
        => authz.EnsureIsOwner(command.CallerUserId, command.FarmId);
}
