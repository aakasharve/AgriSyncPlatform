using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the read that makes the grant switch honest.
///
/// <para><b>Why a read exists at all when the task only asked for grant and
/// revoke.</b> A switch that cannot load its own current state renders whatever
/// the client last guessed — which is precisely the defect Phase 5 exists to
/// remove (<c>TeamMemberCard</c>'s toggles are local React state today and are
/// sent to no server). Without this the UI half could write a grant and then
/// still have nothing truthful to draw. Doctrine P5.</para>
///
/// <para><b>Why not extend <c>LabourPersonDto</c> instead.</b> The approved plan
/// §H lists the five <c>LabourPersonDto</c> mirrors under "Not touched", and its
/// <c>Access</c> field is a hardcoded <c>"review"</c> constant — widening a
/// shape that already carries a placeholder would have spread the placeholder
/// rather than replaced it.</para>
///
/// <para><b>Terminal memberships are excluded.</b> A revoked or exited member
/// has no authority to describe, and listing them would invite an owner to
/// "revoke" a capability from someone who already has no membership.</para>
/// </summary>
public sealed class GetLabourPermissionsHandler(IShramSafalRepository repository)
    : IHandler<GetLabourPermissionsQuery, IReadOnlyList<LabourPermissionDto>>
{
    public async Task<Result<IReadOnlyList<LabourPermissionDto>>> HandleAsync(
        GetLabourPermissionsQuery query, CancellationToken ct = default)
    {
        if (query.FarmId.IsEmpty || query.CallerUserId.IsEmpty)
        {
            return Result.Failure<IReadOnlyList<LabourPermissionDto>>(ShramSafalErrors.InvalidCommand);
        }

        // Defense-in-depth owner re-check. The pipeline's authorizer already ran
        // EnsureIsOwner (and is what set the tenant claim), but a handler must
        // fail closed on its own — the same posture every labour handler takes.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            query.FarmId.Value, query.CallerUserId.Value, ct);
        if (!LabourManagementPermission.CanGrantOrRevoke(callerRole))
        {
            return Result.Failure<IReadOnlyList<LabourPermissionDto>>(ShramSafalErrors.Forbidden);
        }

        var memberships = await repository.GetFarmMembershipsAsync(query.FarmId, ct);

        // Doctrine E4 again: GetFarmMembershipsAsync filters on farm_id, and the
        // request is farm-scoped by GUC — but p_user_select_memberships is a
        // PERMISSIVE FOR SELECT policy OR-ed with the tenant policy that returns
        // the CALLER'S OWN membership rows on every farm. Re-asserting the farm
        // here is what stops a foreign-farm row of the caller's own reaching this
        // list.
        var rows = memberships
            .Where(m => m.FarmId == query.FarmId && !m.IsTerminal)
            .OrderBy(m => m.GrantedAtUtc)
            .Select(LabourPermissionProjection.From)
            .ToArray();

        return Result.Success<IReadOnlyList<LabourPermissionDto>>(rows);
    }
}
