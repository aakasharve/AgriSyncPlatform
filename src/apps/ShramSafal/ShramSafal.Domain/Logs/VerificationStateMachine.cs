using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Logs;

public static class VerificationStateMachine
{
    /// <summary>
    /// Roles that may verify (Confirmed → Verified) or dispute a log.
    /// Extended in CEI Phase 2 §4.7 to include Agronomist and FpcTechnicalManager.
    ///
    /// <para><b>Founder ruling 2026-08-27 did NOT add a role to this set.</b> The
    /// Mukadam question — "can the foreman approve?" — was answered
    /// <i>"if the owner has given that access to him then yes"</i>, which is a
    /// PERMISSION, not a role. Widening this set would have handed the edge to every
    /// Mukadam on every farm forever, with no owner in the loop and no way to take it
    /// back. See the four-argument
    /// <see cref="CanTransitionWithRole(VerificationStatus, VerificationStatus, AppRole, bool)"/>.</para>
    /// </summary>
    private static readonly HashSet<AppRole> OwnerRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.FpcTechnicalManager
    ];

    /// <summary>
    /// Roles that may confirm (Draft → Confirmed) and participate in correction cycle.
    /// FieldScout and LabOperator are intentionally excluded — they may only create Draft logs.
    /// </summary>
    private static readonly HashSet<AppRole> AllRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.SecondaryOwner,
        AppRole.Agronomist,
        AppRole.FpcTechnicalManager,
        AppRole.Consultant,
        AppRole.Mukadam,
        AppRole.Worker
    ];

    private static readonly IReadOnlyDictionary<VerificationStatus, IReadOnlyList<TransitionRule>> Transitions =
        new Dictionary<VerificationStatus, IReadOnlyList<TransitionRule>>
        {
            [VerificationStatus.Draft] =
            [
                new TransitionRule(VerificationStatus.Confirmed, AllRoles)
            ],
            [VerificationStatus.Confirmed] =
            [
                new TransitionRule(VerificationStatus.Verified, OwnerRoles),
                new TransitionRule(VerificationStatus.Disputed, OwnerRoles)
            ],
            [VerificationStatus.Verified] =
            [
                new TransitionRule(VerificationStatus.Disputed, OwnerRoles)
            ],
            [VerificationStatus.Disputed] =
            [
                new TransitionRule(VerificationStatus.CorrectionPending, AllRoles)
            ],
            [VerificationStatus.CorrectionPending] =
            [
                new TransitionRule(VerificationStatus.Draft, AllRoles)
            ]
        };

    public static bool CanTransition(VerificationStatus from, VerificationStatus to)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return false;
        }

        return rules.Any(r => r.To == to);
    }

    /// <summary>
    /// The ROLE-ONLY decision — identical to what this machine has always answered.
    /// Equivalent to the four-argument overload with <c>hasLabourManagementGrant: false</c>.
    ///
    /// <para>Callers that have not resolved the grant must use this form, and it is the
    /// correct form for callers that cannot — the Domain has no database. Answering
    /// "not allowed" for someone who does in fact hold the owner's grant is the
    /// FAIL-CLOSED direction: a refusal is recoverable, a wrongly-approved day is not.</para>
    /// </summary>
    public static bool CanTransitionWithRole(VerificationStatus from, VerificationStatus to, AppRole role) =>
        CanTransitionWithRole(from, to, role, hasLabourManagementGrant: false);

    /// <summary>
    /// spec: 2026-08-25-prod-cutover-waves — FOUNDER RULING 2026-08-27, verbatim:
    /// <i>"if the owner has given that access to him then yes"</i>.
    ///
    /// <para><b>What changed.</b> <c>Confirmed → Verified</c> — approving a day — is now
    /// reachable by an owner-tier role OR by a farm member the owner has EXPLICITLY
    /// granted labour-record management (<c>can_manage_labour_records</c>, the same
    /// stored flag <c>LabourManagementGate</c> already reads for the other governed
    /// labour actions). Nothing else moved: <c>Confirmed → Disputed</c> and
    /// <c>Verified → Disputed</c> stay owner-tier, and no role gained an edge.</para>
    ///
    /// <para><b>Why the grant is a PARAMETER and not a lookup.</b> This is a Domain
    /// type; doctrine E2 forbids it referencing Infrastructure, and reaching for a
    /// repository here would put a database read inside the one rule the entire trust
    /// model rests on. The caller resolves the flag (<c>LabourManagementGate</c>) and
    /// passes the answer in, so the rule stays pure and the DOMAIN suite can enumerate
    /// every role against BOTH grant states without a database — the same reasoning
    /// <see cref="Farms.LabourManagementPermission"/> already documents for itself.</para>
    ///
    /// <para><b>Why the grant does not make the role irrelevant.</b> It opens exactly
    /// ONE edge. A <see cref="AppRole.FieldScout"/> holds no <c>Draft → Confirmed</c>
    /// edge, so a granted FieldScout still cannot walk a Draft log to Verified — a
    /// grant never creates a PATH the role could not already travel. And a caller with
    /// no membership never reaches this method: the role is non-nullable and the
    /// handler refuses a null role before asking.</para>
    ///
    /// <para><b>The refusal that must survive.</b> An UNGRANTED non-owner is still
    /// refused here — that is what stops a foreman approving his own day, and it is
    /// unchanged. <c>OwnerCanApproveAMukadamsLogRealPostgresTests</c> proofs 2/3/3b are
    /// that assertion against real Postgres; do not "simplify" this predicate past
    /// them. Note in particular that the grant read must be the STORED flag, NOT
    /// <c>LabourManagementPermission.IsCarriedByRole</c>: that predicate carries the
    /// Mukadam by role alone (founder decision O-4), and feeding it in here would let
    /// EVERY Mukadam approve — the exact reading the 2026-08-27 ruling corrected.</para>
    /// </summary>
    /// <param name="hasLabourManagementGrant">
    /// The owner's explicit <c>can_manage_labour_records</c> grant for this caller on
    /// THIS farm. Never a role tier, and never anything the client put on the wire.
    /// </param>
    public static bool CanTransitionWithRole(
        VerificationStatus from,
        VerificationStatus to,
        AppRole role,
        bool hasLabourManagementGrant)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return false;
        }

        if (rules.Any(r => r.To == to && r.AllowedRoles.Contains(role)))
        {
            return true;
        }

        return hasLabourManagementGrant && IsOpenedByLabourManagementGrant(from, to);
    }

    public static VerificationStatus GetNextStatusForEdit(VerificationStatus current)
    {
        return current switch
        {
            VerificationStatus.Confirmed => VerificationStatus.Draft,
            VerificationStatus.Verified => VerificationStatus.Draft,
            _ => current
        };
    }

    /// <summary>
    /// The role-only listing. See
    /// <see cref="CanTransitionWithRole(VerificationStatus, VerificationStatus, AppRole)"/>.
    /// </summary>
    public static VerificationStatus[] GetAvailableTransitions(VerificationStatus from, AppRole role) =>
        GetAvailableTransitions(from, role, hasLabourManagementGrant: false);

    /// <summary>
    /// What this caller may actually do next, grant included.
    ///
    /// <para><b>This overload exists so the read surfaces cannot lie the OTHER way.</b>
    /// The verification-transitions endpoint and the labour review inbox both render
    /// from this list. Left on the role-only form they would tell a granted member
    /// "you cannot approve this" about a log the server would in fact let him approve —
    /// a control that is absent rather than one that does nothing, but the same class
    /// of defect <see cref="Farms.LabourManagementPermission.IsRedundantGrantTarget"/>
    /// was added to prevent.</para>
    /// </summary>
    public static VerificationStatus[] GetAvailableTransitions(
        VerificationStatus from,
        AppRole role,
        bool hasLabourManagementGrant)
    {
        if (!Transitions.TryGetValue(from, out var rules))
        {
            return [];
        }

        return rules
            .Where(r => r.AllowedRoles.Contains(role)
                || (hasLabourManagementGrant && IsOpenedByLabourManagementGrant(from, r.To)))
            .Select(r => r.To)
            .ToArray();
    }

    /// <summary>
    /// THE entire surface of founder ruling 2026-08-27: one edge, named in one place,
    /// so "honour the grant" can never quietly spread to a second transition. Approving
    /// a day is the act an owner delegates. DISPUTING one — and the correction cycle
    /// that opens — is not, and was not ruled on.
    /// </summary>
    private static bool IsOpenedByLabourManagementGrant(VerificationStatus from, VerificationStatus to) =>
        from == VerificationStatus.Confirmed && to == VerificationStatus.Verified;

    private sealed record TransitionRule(VerificationStatus To, IReadOnlySet<AppRole> AllowedRoles);
}
