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
    /// Legacy bootstrap factory. Callers that created memberships before the
    /// state machine existed assumed every membership was <see cref="MembershipStatus.Active"/>
    /// via <see cref="JoinedVia.PrimaryOwnerBootstrap"/>; we keep this
    /// signature so those callers (and their tests) continue to compile.
    /// New code should use <see cref="CreateFromInvitation"/> instead.
    /// </summary>
    public static FarmMembership Create(
        Guid id,
        FarmId farmId,
        UserId userId,
        AppRole role,
        DateTime grantedAtUtc)
    {
        EnsureValidIds(id, farmId, userId);

        return new FarmMembership(
            id,
            farmId,
            userId,
            role,
            MembershipStatus.Active,
            JoinedVia.PrimaryOwnerBootstrap,
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
