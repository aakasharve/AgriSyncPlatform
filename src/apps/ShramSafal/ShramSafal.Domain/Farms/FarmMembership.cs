using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Farms;

/// <summary>
/// A user's membership of a single farm.
///
/// State machine (plan spec §8.5.1):
///
///   PendingOtpClaim ──(ClaimWithoutApproval)──► Active
///   PendingOtpClaim ──(ClaimAwaitingApproval)──► PendingApproval
///   PendingApproval ──(Approve)──► Active
///   Active ──(Suspend)──► Suspended ──(Restore)──► Active
///   Active ──(Revoke)──► Revoked   (terminal)
///   Active ──(Exit)──►   Exited    (terminal)
///   {PendingOtpClaim|PendingApproval} ──(Revoke)──► Revoked
///
/// Invariant I3 is enforced in the aggregate method
/// <see cref="Revoke(DateTime,bool)"/> via the <c>isLastActivePrimaryOwner</c>
/// argument; the caller (use-case handler) must supply the result of a
/// repository check before calling Revoke.
/// </summary>
public sealed class FarmMembership : Entity<Guid>
{
    private FarmMembership() : base(Guid.Empty) { } // EF Core

    private FarmMembership(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        MembershipStatus status,
        JoinedVia joinedVia,
        FarmInvitationId? invitationId,
        DateTime grantedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        UserId = userId;
        Role = role;
        Status = status;
        JoinedVia = joinedVia;
        InvitationId = invitationId;
        GrantedAtUtc = grantedAtUtc;
        ModifiedAtUtc = grantedAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public UserId UserId { get; private set; }
    public AppRole Role { get; private set; }
    public MembershipStatus Status { get; private set; }
    public JoinedVia JoinedVia { get; private set; }
    public FarmInvitationId? InvitationId { get; private set; }
    public UserId? ApprovedByUserId { get; private set; }
    public DateTime GrantedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public DateTime? LastSeenAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }
    public DateTime? ExitedAtUtc { get; private set; }

    /// <summary>
    /// LABOUR_PHASE2 Phase 5 (founder decision O-4) — the owner's EXPLICIT
    /// grant of labour-record management to a member whose role does not
    /// already carry it.
    ///
    /// <para><b>This is not the whole rule and must never be read as if it
    /// were.</b> The effective decision is
    /// <see cref="LabourManagementPermission.IsAllowed"/>: owner-tier is always
    /// allowed, so for those two roles this flag is irrelevant and stays
    /// <c>false</c>; for every other role — Mukadam included (D5, 2026-09-02) —
    /// this flag IS the decision. Reading this property alone would deny the
    /// two roles that are always permitted.</para>
    ///
    /// <para>Default <c>false</c>: a member gains nothing until an owner says
    /// so. That is also why the column ships <c>NOT NULL DEFAULT false</c> —
    /// every pre-existing row means "never granted", which is exactly true.
    /// </para>
    /// </summary>
    public bool CanManageLabourRecords { get; private set; }

    /// <summary>
    /// R1 Task 2.2 (founder master review 2026-09-02, D5) — when the explicit
    /// labour grant STOPS answering. <c>null</c> = कायम, no end date.
    ///
    /// <para><b>Expiry denies forward, never rewrites backward.</b> What the
    /// person did while responsible keeps its history — "प्रकाशने काल केलेली
    /// नोंद प्रकाशच केली म्हणून कायम दिसेल." Nothing here touches audit rows,
    /// corrections or marks; only future answers change.</para>
    ///
    /// <para>Meaningless without the grant: <see cref="SetLabourRecordManagement"/>
    /// clears it on revoke, so an expiry can never outlive the decision it
    /// bounds.</para>
    /// </summary>
    public DateTime? LabourGrantExpiresAtUtc { get; private set; }

    /// <summary>
    /// The stored decision evaluated at a moment: granted AND not yet expired.
    /// BOTH readers of the grant answer through this rule — the SQL twin in
    /// <c>GetLabourManagementGrantAsync</c> for the gate, this method for the
    /// projection. A roster reading the bare flag while the gate reads
    /// flag+expiry is a control that lies.
    /// </summary>
    public bool HasEffectiveLabourGrant(DateTime nowUtc) =>
        CanManageLabourRecords
        && (LabourGrantExpiresAtUtc is null || nowUtc < LabourGrantExpiresAtUtc);

    /// <summary>
    /// Legacy surface preserved for pre-Phase 2 callers. Returns <c>true</c>
    /// for any terminal status (<see cref="MembershipStatus.Revoked"/> or
    /// <see cref="MembershipStatus.Exited"/>).
    /// </summary>
    public bool IsRevoked =>
        Status is MembershipStatus.Revoked or MembershipStatus.Exited;

    public bool IsActive => Status == MembershipStatus.Active;

    public bool IsTerminal =>
        Status is MembershipStatus.Revoked or MembershipStatus.Exited;

    /// <summary>
    /// Direct (no-invitation) factory producing an immediately
    /// <see cref="MembershipStatus.Active"/> membership. Callers that created
    /// memberships before the state machine existed assumed every membership
    /// was Active via <see cref="JoinedVia.PrimaryOwnerBootstrap"/>; the
    /// <paramref name="joinedVia"/> parameter therefore defaults to that value
    /// so those callers (and their tests) continue to compile and behave
    /// identically.
    ///
    /// <para>
    /// Pass <see cref="JoinedVia.OwnerManualAdd"/> when the owner adds a member
    /// directly rather than through the QR/OTP invitation flow — that path has
    /// no <see cref="FarmInvitation"/> to reference, so
    /// <see cref="CreateFromInvitation"/> (which requires an invitation id and
    /// yields a Pending* status) cannot express it. <c>joinedVia</c> is an
    /// audit-only signal, never an authorization input (spec §8.5.1), so this
    /// widens provenance fidelity without touching the state machine.
    /// </para>
    /// </summary>
    public static FarmMembership Create(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        DateTime grantedAtUtc,
        JoinedVia joinedVia = JoinedVia.PrimaryOwnerBootstrap)
    {
        EnsureValidIds(id, farmId, userId);

        return new FarmMembership(
            id,
            farmId,
            userId,
            role,
            MembershipStatus.Active,
            joinedVia,
            invitationId: null,
            grantedAtUtc);
    }

    /// <summary>
    /// QR/OTP onboarding factory. The resulting membership is either
    /// <see cref="MembershipStatus.PendingOtpClaim"/> (server will flip to
    /// Active on successful claim) or <see cref="MembershipStatus.PendingApproval"/>
    /// when the invitation required owner approval.
    /// </summary>
    public static FarmMembership CreateFromInvitation(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        JoinedVia joinedVia,
        FarmInvitationId invitationId,
        bool requireApproval,
        DateTime grantedAtUtc)
    {
        EnsureValidIds(id, farmId, userId);

        var status = requireApproval
            ? MembershipStatus.PendingApproval
            : MembershipStatus.PendingOtpClaim;

        return new FarmMembership(id, farmId, userId, role, status, joinedVia, invitationId, grantedAtUtc);
    }

    public void ClaimWithoutApproval(DateTime utcNow)
    {
        if (Status != MembershipStatus.PendingOtpClaim)
        {
            throw new InvalidOperationException(
                $"Membership '{Id}' cannot be claimed from status {Status}.");
        }

        Status = MembershipStatus.Active;
        ModifiedAtUtc = utcNow;
        LastSeenAtUtc = utcNow;
    }

    public void Approve(UserId approverUserId, DateTime utcNow)
    {
        if (Status != MembershipStatus.PendingApproval)
        {
            throw new InvalidOperationException(
                $"Membership '{Id}' is not awaiting approval (current status {Status}).");
        }

        if (approverUserId.IsEmpty)
        {
            throw new ArgumentException("Approver id is required.", nameof(approverUserId));
        }

        Status = MembershipStatus.Active;
        ApprovedByUserId = approverUserId;
        ModifiedAtUtc = utcNow;
    }

    public void Suspend(DateTime utcNow)
    {
        if (Status != MembershipStatus.Active)
        {
            throw new InvalidOperationException(
                $"Only Active memberships can be suspended (current {Status}).");
        }

        Status = MembershipStatus.Suspended;
        ModifiedAtUtc = utcNow;
    }

    public void Restore(DateTime utcNow)
    {
        if (Status != MembershipStatus.Suspended)
        {
            throw new InvalidOperationException(
                $"Only Suspended memberships can be restored (current {Status}).");
        }

        Status = MembershipStatus.Active;
        ModifiedAtUtc = utcNow;
    }

    /// <summary>
    /// Legacy single-argument Revoke preserved for existing callers. New
    /// callers should use the overload that supplies invariant I3
    /// protection data.
    /// </summary>
    public void Revoke(DateTime utcNow)
    {
        Revoke(utcNow, isLastActivePrimaryOwner: false);
    }

    /// <summary>
    /// Revoke this membership. If the caller determines this is the last
    /// Active PrimaryOwner membership for the farm it must set
    /// <paramref name="isLastActivePrimaryOwner"/> to <c>true</c>; the
    /// operation will then fail per invariant I3.
    /// </summary>
    public void Revoke(DateTime utcNow, bool isLastActivePrimaryOwner)
    {
        if (IsTerminal)
        {
            return;
        }

        if (Role == AppRole.PrimaryOwner
            && Status == MembershipStatus.Active
            && isLastActivePrimaryOwner)
        {
            throw new LastPrimaryOwnerRevocationException(FarmId);
        }

        Status = MembershipStatus.Revoked;
        RevokedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
    }

    public void Exit(DateTime utcNow, bool isLastActivePrimaryOwner)
    {
        if (IsTerminal)
        {
            return;
        }

        if (Role == AppRole.PrimaryOwner
            && Status == MembershipStatus.Active
            && isLastActivePrimaryOwner)
        {
            throw new LastPrimaryOwnerRevocationException(FarmId);
        }

        Status = MembershipStatus.Exited;
        ExitedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
    }

    public void ChangeRole(AppRole newRole, DateTime utcNow)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException(
                $"Cannot change role of a {Status} membership.");
        }

        Role = newRole;
        ModifiedAtUtc = utcNow;
    }

    /// <summary>
    /// LABOUR_PHASE2 Phase 5 — grant or withdraw the explicit labour-record
    /// capability. Returns <c>true</c> when the stored value ACTUALLY moved.
    ///
    /// <para><b>Why it returns whether anything changed.</b> The caller writes
    /// an <c>AuditEvent</c> only on a real change. Re-sending the state the row
    /// already held is not a decision and must not appear in history as one —
    /// the same rule <c>CorrectLabourHandler.AddIfChanged</c> applies to labour
    /// corrections (P3: history stays explainable, and a no-op is not an
    /// event). It is also what makes the endpoint safely idempotent for a
    /// farmer on a flaky connection re-sending the same toggle.</para>
    ///
    /// <para><b>Terminal memberships are refused, not silently ignored.</b>
    /// Granting a capability to someone who has been revoked or has exited is
    /// meaningless, and writing it would leave a row claiming a live permission
    /// on a dead membership. Mirrors <see cref="ChangeRole"/>.</para>
    ///
    /// <para><b>Roles that already carry the capability are NOT filtered
    /// here.</b> This entity records the owner's explicit decision; whether the
    /// decision is redundant is a use-case question, answered by
    /// <see cref="LabourManagementPermission.IsRedundantGrantTarget"/> at the
    /// handler so the caller can be told rather than silently no-op'd.</para>
    ///
    /// <para><b>The expiry travels WITH the grant: cleared on revoke, refused
    /// when already past.</b> (R1 Task 2.2, founder master review 2026-09-02,
    /// D5 — temporary जबाबदारी is the SAME switch with a duration, never a
    /// second permission.)</para>
    /// </summary>
    public bool SetLabourRecordManagement(bool allowed, DateTime? expiresAtUtc, DateTime utcNow)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException(
                $"Cannot change labour-record management on a {Status} membership.");
        }

        var effectiveExpiry = allowed ? expiresAtUtc : null;

        if (allowed && effectiveExpiry is not null && effectiveExpiry <= utcNow)
        {
            throw new ArgumentException(
                "An expiry in the past grants nothing — refusing rather than storing a switch "
                + "that looks ON and answers OFF.", nameof(expiresAtUtc));
        }

        if (CanManageLabourRecords == allowed && LabourGrantExpiresAtUtc == effectiveExpiry)
        {
            return false;
        }

        CanManageLabourRecords = allowed;
        LabourGrantExpiresAtUtc = effectiveExpiry;
        ModifiedAtUtc = utcNow;
        return true;
    }

    public void RecordActivity(DateTime utcNow)
    {
        if (Status == MembershipStatus.Active)
        {
            LastSeenAtUtc = utcNow;
            ModifiedAtUtc = utcNow;
        }
    }

    private static void EnsureValidIds(Guid id, FarmId farmId, UserId userId)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Membership id is required.", nameof(id));
        }

        if (farmId.IsEmpty)
        {
            throw new ArgumentException("Farm id is required.", nameof(farmId));
        }

        if (userId.IsEmpty)
        {
            throw new ArgumentException("User id is required.", nameof(userId));
        }
    }
}

/// <summary>
/// Thrown when an operation would leave a farm without any active
/// PrimaryOwner membership. Invariant I3.
/// </summary>
public sealed class LastPrimaryOwnerRevocationException : InvalidOperationException
{
    public LastPrimaryOwnerRevocationException(FarmId farmId)
        : base($"Farm '{farmId}' cannot lose its last active PrimaryOwner membership (invariant I3). Promote another owner first.")
    {
        FarmId = farmId;
    }

    public FarmId FarmId { get; }
}
