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
/// <para><b>And a sixth call, added 2026-08-27 — not a sixth rule.</b> Passing the
/// enforcer was never enough to approve a log: <c>VerificationStateMachine</c> checked
/// the role tier again one layer deeper and refused the very callers the enforcer had
/// just admitted. <see cref="HasExplicitGrantAsync"/> hands that machine the SAME stored
/// grant this file already reads, so the two layers agree by construction instead of by
/// coincidence. Call sites: <c>VerifyLogHandler</c> (the decision),
/// <c>GetLabourDataHandler</c> and <c>LogsEndpoints</c> (the two read surfaces that
/// render what a caller may do next).</para>
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
/// question on its own for owner-tier, so the grant read never happens for the
/// roles that dominate real traffic. It also means a caller with NO membership
/// is denied before the grant is consulted at all — a grant cannot outlive the
/// membership that carries it.</para>
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
    /// spec: 2026-08-25-prod-cutover-waves — founder ruling 2026-08-27, verbatim:
    /// <i>"if the owner has given that access to him then yes"</i>. The RAW stored
    /// <c>can_manage_labour_records</c> flag, and the only sanctioned way for a handler
    /// to obtain it — <see cref="IShramSafalRepository.GetLabourManagementGrantAsync"/>
    /// says in its own remarks "do not call this member directly from a handler", and
    /// that rule still holds; this is the one place that call lives.
    ///
    /// <para><b>Why the raw flag and not <see cref="IsAllowedAsync"/>.</b> Its consumer
    /// is <c>VerificationStateMachine</c>, which is a Domain type and cannot read a
    /// database (doctrine E2), so the resolved answer has to be passed in. And it must
    /// be the GRANT, not the decision: the FSM enumerates roles itself and takes the
    /// stored grant as its second input — feeding it the resolved decision would
    /// double-count the role and collapse the FSM's role/grant split into one
    /// pre-mixed answer it can no longer reason about.</para>
    ///
    /// <para><c>ResolveAsync</c> and <c>LabourManagementDecision</c> were deleted
    /// 2026-09-02: zero callers, and a third copy of the rule. The read surface
    /// projects via <c>LabourPermissionProjection.From</c>.</para>
    ///
    /// <para>Returns <c>false</c> for empty ids — fail-closed, same posture as
    /// <see cref="IsAllowedAsync"/>.</para>
    /// </summary>
    public static async Task<bool> HasExplicitGrantAsync(
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

        return await repository.GetLabourManagementGrantAsync(farmId, userId, ct);
    }
}
