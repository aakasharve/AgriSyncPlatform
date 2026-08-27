using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — <b>THE</b> rule for who may rewrite labour truth on
/// a farm. Founder decision O-4, 2026-08-12:
///
/// <code>
/// PrimaryOwner / SecondaryOwner  -> always allowed
/// Mukadam                        -> allowed by default (field verification IS the role)
/// any other role                 -> allowed ONLY if explicitly granted
/// not a member                   -> denied
/// </code>
///
/// <para><b>Scope, stated precisely — founder ruling 2026-08-27.</b> The table above
/// governs the four labour-EDIT actions. APPROVING a log is a fifth action and does
/// NOT read this table: <c>VerificationStateMachine</c> owns that edge and takes
/// owner-tier OR the explicit grant, so a Mukadam approves only when the owner has
/// given him that access. See <see cref="IsCarriedByRole"/> for why the two must not
/// be collapsed back into one answer.</para>
///
/// <para><b>Why this type exists at all.</b> Before Phase 5 the five governed
/// actions obeyed THREE different rules: creating / renaming / attaching a
/// field operator accepted any member (a Worker included), correcting labour
/// accepted owner-tier + Mukadam, and approve/verify accepted owner-tier ONLY —
/// which excluded the Mukadam, the person actually doing the field
/// verification. Three copies of an authorization rule is three chances to
/// drift, and it had already drifted. One predicate, five call sites, no
/// second permission system.</para>
///
/// <para><b>Deliberately NOT here:</b> subscription/billing. <c>IEntitlementPolicy</c>
/// answers <i>"has this farm paid?"</i> (<c>PaidFeature</c>,
/// <c>SubscriptionExpired</c>). Routing labour through it would make correcting
/// a headcount a paid feature. The founder has ruled that out; do not add it.
/// Equally not here: new roles. <c>Approver</c> / <c>Supervisor</c> /
/// <c>Verifier</c> do not exist and must not be invented — the capability is
/// keyed on (farm, user), never on the user alone.</para>
///
/// <para><b>Pure by design.</b> No repository, no I/O, no clock — the async
/// resolution of "what is this caller's role, and were they granted?" lives in
/// <c>ShramSafal.Application.Services.LabourManagementGate</c>. Keeping the
/// decision itself pure is what lets the DOMAIN suite enumerate every role
/// against both grant states without a database.</para>
/// </summary>
public static class LabourManagementPermission
{
    /// <summary>
    /// Roles whose membership alone carries labour-record management, with no
    /// explicit grant required and no way for an owner to take it away short of
    /// changing the role itself.
    ///
    /// <para><see cref="AppRole.Mukadam"/> is in this set BY FOUNDER DECISION
    /// (O-4), and it genuinely changed the four labour-EDIT actions: correcting a
    /// headcount, correcting a duration, changing attribution, and managing
    /// FieldOperator identity.</para>
    ///
    /// <para><b>CORRECTION, 2026-08-27 — this comment used to claim more than the
    /// code did.</b> It said O-4 "closed" the contradiction that a Mukadam could
    /// correct a headcount but not verify the log it belonged to. It did not.
    /// <c>EnsureCanVerify</c> did start asking this predicate, so the Mukadam passed
    /// the ENFORCER — and was then refused one layer deeper by
    /// <c>VerificationStateMachine</c>, whose <c>Confirmed → Verified</c> edge is
    /// owner-tier. For fifteen days the claim was false in production and no test
    /// said so, because every test double defaults the grant to <c>false</c> and a
    /// denial that passes for the wrong reason looks exactly like one that passes for
    /// the right one.</para>
    ///
    /// <para><b>What is true now.</b> Founder ruling 2026-08-27, verbatim:
    /// <i>"if the owner has given that access to him then yes"</i> — approval is
    /// PERMISSION-gated, not role-gated. So:</para>
    /// <code>
    /// the four labour-EDIT actions  -> this set applies; a Mukadam needs no grant
    /// approving a log (Confirmed->Verified) -> owner-tier, OR the EXPLICIT
    ///                                          can_manage_labour_records grant
    /// </code>
    /// <para>An UNGRANTED Mukadam still cannot approve, and that is the ruling
    /// working as intended rather than a leftover of the old bug — it is what stops a
    /// foreman signing off his own day. The verification FSM therefore takes the
    /// STORED grant flag, never <see cref="IsCarriedByRole"/>: feeding this predicate
    /// to it would restore role-gating and hand the edge to every Mukadam on every
    /// farm. Proofs: <c>OwnerCanApproveAMukadamsLogRealPostgresTests</c> — one
    /// granted Mukadam approves, three ungranted callers are refused.</para>
    /// </summary>
    public static bool IsCarriedByRole(AppRole role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner or AppRole.Mukadam;

    /// <summary>
    /// The effective decision. <paramref name="role"/> is <c>null</c> when the
    /// caller has no non-terminal membership on the farm at all — denied, and
    /// the explicit grant is not even consulted, because a grant cannot outlive
    /// the membership that carries it.
    /// </summary>
    public static bool IsAllowed(AppRole? role, bool hasExplicitGrant) =>
        role is { } actual && (IsCarriedByRole(actual) || hasExplicitGrant);

    /// <summary>
    /// Who may hand the capability to someone else, or take it back: owner-tier
    /// only. A Mukadam holds the capability but cannot spread it — O-4 says
    /// <i>"the owner decides who is trusted."</i>
    /// </summary>
    public static bool CanGrantOrRevoke(AppRole? role) =>
        role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;

    /// <summary>
    /// <c>true</c> when toggling the explicit grant on this role would change
    /// nothing, because the role already carries the capability.
    ///
    /// <para><b>This is a P5 guard, not a micro-optimisation.</b> An owner
    /// switching "approve entries" OFF for a Mukadam would store
    /// <c>can_manage_labour_records = false</c> and the Mukadam would carry
    /// right on approving — a control that looks functional and does nothing.
    /// The handler rejects that request with a distinct error instead, so the
    /// UI is forced to render those members as permanently-on rather than as an
    /// interactive switch that lies.</para>
    /// </summary>
    public static bool IsRedundantGrantTarget(AppRole role) => IsCarriedByRole(role);
}
