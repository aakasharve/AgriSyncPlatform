using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — <b>THE</b> rule for who may rewrite labour truth on
/// a farm:
///
/// <code>
/// PrimaryOwner / SecondaryOwner        -> always allowed
/// any other role — Mukadam included    -> allowed ONLY if explicitly granted
/// not a member                         -> denied
/// </code>
///
/// <para><b>SUPERSESSION, 2026-09-02 (founder master review, D5).</b> O-4 placed
/// Mukadam in the carried set; D5 removes him: ONE owner-held switch
/// ("जबाबदारी"), optionally time-bounded, governs every non-owner — a Mukadam
/// included. Existing Mukadams start OFF; there is NO backfill — the deletion
/// of the role carry IS the migration behaviour. History made while authorised
/// is untouched: expiry and revocation deny forward, never rewrite backward.</para>
///
/// <para><b>Scope.</b> The table governs all five labour actions: the enforcer
/// asks it (via <c>LabourManagementGate</c>) for the four labour-EDIT actions
/// AND for approve/verify. <c>VerificationStateMachine</c> remains the second
/// lock on the <c>Confirmed → Verified</c> edge — it takes owner-tier OR the
/// STORED grant, never <see cref="IsCarriedByRole"/> — so a Mukadam approves
/// only when the owner has given him that access (founder ruling 2026-08-27).</para>
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
    /// <para><b>Owner-tier only</b> (founder master review 2026-09-02, D5). For
    /// every other role — Mukadam included — the stored
    /// <c>can_manage_labour_records</c> grant (plus its expiry, Task 2.2) is the
    /// whole answer, for all five governed actions.</para>
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
    /// <para>Founder ruling 2026-08-27, verbatim: <i>"if the owner has given that
    /// access to him then yes"</i> — approval is PERMISSION-gated, not role-gated.
    /// The verification FSM therefore takes the STORED grant flag, never
    /// <see cref="IsCarriedByRole"/>: feeding this predicate to it would hand the
    /// edge to owner-tier only and ignore a genuine grant. Proofs:
    /// <c>OwnerCanApproveAMukadamsLogRealPostgresTests</c> — one granted Mukadam
    /// approves, three ungranted callers are refused.</para>
    /// </summary>
    ///
    /// <para><b>lane 2b (founder D-22 / D-26, 2026-10-31) — the PRIMARY owner only.</b> A सहमालक /
    /// कुटुंब label no longer carries labour edits: "neither automatically grants operational …
    /// powers". Every existing co-owner seat kept them through the 2b migration, which stored the
    /// grant explicitly (P11); a new co-owner holds them only when the primary owner switches
    /// "हजेरी" on.</para>
    public static bool IsCarriedByRole(AppRole role) =>
        role is AppRole.PrimaryOwner;

    /// <summary>
    /// The effective decision. <paramref name="role"/> is <c>null</c> when the
    /// caller has no non-terminal membership on the farm at all — denied, and
    /// the explicit grant is not even consulted, because a grant cannot outlive
    /// the membership that carries it.
    /// </summary>
    public static bool IsAllowed(AppRole? role, bool hasExplicitGrant) =>
        role is { } actual && (IsCarriedByRole(actual) || hasExplicitGrant);

    /// <summary>
    /// Who may hand the capability to someone else, or take it back: the PRIMARY
    /// owner only. Even a member the owner granted cannot spread it — O-4 says
    /// <i>"the owner decides who is trusted."</i>
    ///
    /// <para><b>spec: plr-d10 (I27) — founder D-44 §2, verbatim:</b> <i>"The primary
    /// owner may confirm personally or explicitly delegate this responsibility to a
    /// family member, trusted मुकादम or another selected member. Being appointed
    /// मुकादम or co-owner must not automatically grant this authority."</i> The switch
    /// now also decides who confirms records on the owner's behalf, so a co-owner who
    /// could move it could create confirmers — himself included. Until 2026-10-30 this
    /// admitted owner-tier (a co-owner too); a co-owner is now refused with the same
    /// uniform <c>Forbidden</c> every other refusal on the write path returns.</para>
    /// </summary>
    public static bool CanGrantOrRevoke(AppRole? role) =>
        role is AppRole.PrimaryOwner;

    /// <summary>
    /// spec: plr-d10 (I27) — who may READ the farm's grant roster (the team screen's
    /// list): owner-tier, as before. Reading is not deciding; a co-owner keeps seeing
    /// the roster he saw yesterday, he only no longer moves the switch.
    /// </summary>
    ///
    /// <para><b>lane 2b — the PRIMARY owner only.</b> The roster of who may do what is "people and
    /// permissions", which D-26 gives the primary account holder alone; a co-owner label no longer
    /// reads it (listed as one of the co-owner's primary-owner-only removals).</para>
    public static bool CanViewGrants(AppRole? role) =>
        role is AppRole.PrimaryOwner;

    /// <summary>
    /// <c>true</c> when toggling the explicit grant on this role would change
    /// nothing, because the role already carries the capability.
    ///
    /// <para><b>This is a P5 guard, not a micro-optimisation.</b> Storing the flag
    /// for someone on whom it changes nothing would be a control that looks
    /// functional and does nothing, so the handler rejects that request with a
    /// distinct error instead. A Mukadam is NOT a redundant target any more — his
    /// switch is real (D5, 2026-09-02).</para>
    ///
    /// <para><b>spec: plr-d10 (I27), founder D-44 §2 — a co-owner is not a redundant
    /// target any more either.</b> His labour edits still come with the role
    /// (<see cref="IsCarriedByRole"/>, unchanged — taking them away is the D-26
    /// permission system), but confirming records on the owner's behalf does NOT come
    /// with the role: <c>OwnerConfirmationAuthority</c> reads this stored flag for him.
    /// So for a co-owner the switch really controls confirming. Only the primary
    /// owner, who confirms by role, is a target on whom the flag changes nothing.</para>
    /// </summary>
    public static bool IsRedundantGrantTarget(AppRole role) => role is AppRole.PrimaryOwner;
}
