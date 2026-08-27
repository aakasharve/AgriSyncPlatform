using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Services;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the ONE place that resolves
/// <see cref="LabourManagementPermission"/> against the database, and therefore
/// the one place the five governed labour actions agree.
///
/// <para><b>The five call sites</b> (do not add a sixth rule; add a sixth call):
/// <list type="number">
/// <item>correcting a labour headcount — <c>CorrectLabourHandler</c></item>
/// <item>correcting a duration — the same handler, same request</item>
/// <item>changing attribution — the same handler, plus <c>AttachFieldOperatorHandler</c></item>
/// <item>managing FieldOperator identity — <c>CreateFieldOperatorHandler</c> / <c>RenameFieldOperatorHandler</c></item>
/// <item>reviewing / approving labour — <c>ShramSafalAuthorizationEnforcer.EnsureCanVerify</c></item>
/// </list>
/// </para>
///
/// <para><b>Why a static helper and not an injected service.</b> Four of the
/// five call sites are handlers that already take <c>IShramSafalRepository</c>;
/// the fifth lives in Infrastructure and takes it too. An injected service would
/// have added a constructor parameter to five types, a DI registration, and a
/// new member on every test double that constructs those handlers — for a
/// function with no state, no clock and no I/O of its own. The rule itself is
/// pure and lives in the Domain; this is only the two-read resolution of it.</para>
///
/// <para><b>Ordering is deliberate.</b> The role is read first and answers the
/// question on its own for owner-tier and Mukadam, so the grant read never
/// happens for the roles that dominate real traffic. It also means a caller with
/// NO membership is denied before the grant is consulted at all — a grant cannot
/// outlive the membership that carries it.</para>
/// </summary>
public static class LabourManagementGate
{
    /// <summary>
    /// <c>true</c> when this caller may rewrite labour truth on this farm.
    ///
    /// <para>Callers should map <c>false</c> to
    /// <c>ShramSafalErrors.Forbidden</c> — never <c>NotFound</c> — so a forged
    /// farm id cannot be used to probe existence, which is the posture every
    /// labour handler already takes.</para>
    /// </summary>
    public static async Task<bool> IsAllowedAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        var role = await repository.GetUserRoleForFarmAsync(farmId, userId, ct);
        if (role is null)
        {
            return false;
        }

        if (LabourManagementPermission.IsCarriedByRole(role.Value))
        {
            return true;
        }

        return await repository.GetLabourManagementGrantAsync(farmId, userId, ct);
    }

    /// <summary>
    /// The same decision, plus the role that produced it and the raw grant
    /// flag — for the access-management surface, which has to SHOW an owner why
    /// a member is allowed (role-carried vs explicitly granted) rather than just
    /// whether they are. Never used for a gate; <see cref="IsAllowedAsync"/> is.
    /// </summary>
    public static async Task<LabourManagementDecision> ResolveAsync(
        IShramSafalRepository repository,
        Guid farmId,
        Guid userId,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);

        var role = await repository.GetUserRoleForFarmAsync(farmId, userId, ct);
        if (role is null)
        {
            return new LabourManagementDecision(null, HasExplicitGrant: false, IsAllowed: false);
        }

        if (LabourManagementPermission.IsCarriedByRole(role.Value))
        {
            return new LabourManagementDecision(role, HasExplicitGrant: false, IsAllowed: true);
        }

        var granted = await repository.GetLabourManagementGrantAsync(farmId, userId, ct);
        return new LabourManagementDecision(role, granted, granted);
    }
}

/// <summary>
/// Why a caller is (or is not) allowed to manage labour records — the shape the
/// access-management read renders from.
/// </summary>
/// <param name="Role">
/// The caller's role on the farm, or <c>null</c> when they have no non-terminal
/// membership at all.
/// </param>
/// <param name="HasExplicitGrant">
/// The stored <c>can_manage_labour_records</c> flag. Reported as <c>false</c>
/// for roles that carry the capability anyway, because for those roles the flag
/// is not consulted and showing a stored value would invite a UI that pretends
/// it can be switched off.
/// </param>
/// <param name="IsAllowed">The effective decision.</param>
public sealed record LabourManagementDecision(
    AppRole? Role,
    bool HasExplicitGrant,
    bool IsAllowed);
