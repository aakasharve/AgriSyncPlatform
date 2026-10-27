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
///   PendingApproval + SelfJoin ──(ActivateFromOwnerQr)──► Active   (typed-code request, owner's QR)
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
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — what the owner switched on for this person,
    /// beyond the role. <c>null</c> = the role's defaults (every row written before step 2), so an
    /// old row answers exactly what its role answers (P11). Read it through
    /// <see cref="EffectivePermissions"/>, never on its own.
    /// </summary>
    public FarmPermission? Permissions { get; private set; }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner's written reason for the last
    /// status decision (pause, removal, decline). A PAUSED person is shown it ("काम थांबवलं —
    /// कारण…"); a decline or removal reason is kept as history only — the ended seat is no longer
    /// listed to that person (<c>/me/context</c> and <c>/farms/mine</c> list live seats).
    /// Cleared when the seat is approved or restored. At most 500 characters.
    /// </summary>
    public string? StatusReason { get; private set; }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — who made the last status decision: the owner
    /// for approve / decline / pause / restore / remove, the person himself for a plain exit. An
    /// exit from a PAUSED seat keeps the owner's pause here (see <see cref="EndedAfterOwnerStop"/>).
    /// </summary>
    public UserId? StatusChangedByUserId { get; private set; }

    /// <summary>spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — when <see cref="StatusChangedByUserId"/> decided.</summary>
    public DateTime? StatusChangedAtUtc { get; private set; }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the last time what this person may READ or
    /// DO on the farm changed (status, role or permissions). Step 4 compares it with the phone's
    /// pull cursor so a widened access re-sends the farm from the beginning (plan §2 #6).
    /// </summary>
    public DateTime? AccessChangedAtUtc { get; private set; }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the effective permission set of THIS seat:
    /// <see cref="FarmPermissionDefaults.Effective"/> over the role and the stored choice, and
    /// nothing at all unless the seat is <see cref="MembershipStatus.Active"/> (a waiting request,
    /// a pause or an ended seat grants nothing).
    /// </summary>
    public FarmPermission EffectivePermissions =>
        Status == MembershipStatus.Active
            ? FarmPermissionDefaults.Effective(Role, Permissions)
            : FarmPermission.None;

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, SEC-2) — this seat ended because the OWNER
    /// stopped it: removed or declined (<see cref="MembershipStatus.Revoked"/>), or the person left
    /// while PAUSED (an exit keeps the owner's pause as the last decision). A person whose last seat
    /// ended this way must not get a fresh Active seat by scanning the farm QR again — the claim
    /// waits for the owner's approval. A plain exit from an Active seat is not a stop.
    /// </summary>
    public bool EndedAfterOwnerStop =>
        Status == MembershipStatus.Revoked
        || (Status == MembershipStatus.Exited
            && StatusChangedByUserId is { } by
            && by != UserId);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, SEC-2) — the OWNER let this seat in: he
    /// approved it (<see cref="ApprovedByUserId"/>), or he added the person himself
    /// (<see cref="JoinedVia.OwnerManualAdd"/> / <see cref="JoinedVia.PrimaryOwnerBootstrap"/>).
    /// A farm-QR claim or a typed-code request is the PERSON asking, never this.
    /// </summary>
    public bool WasLetInByOwner =>
        ApprovedByUserId is not null
        || JoinedVia is JoinedVia.OwnerManualAdd or JoinedVia.PrimaryOwnerBootstrap;

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, SEC-2) — over ALL of one person's seats on
    /// one farm: did the owner stop him (<see cref="EndedAfterOwnerStop"/>) with no owner
    /// let-in (<see cref="WasLetInByOwner"/>) on any seat made AFTER that stop? While this is
    /// <c>true</c> the farm QR only ever makes him a waiting request.
    ///
    /// <para><b>Why the whole history and not the newest ended seat.</b> A seat the person ends
    /// himself — a withdrawn request ("विनंती मागे घ्या"), a plain exit — is not the owner's
    /// answer. Reading only the newest ended row let a stopped person withdraw his own waiting
    /// request (a newer, self-ended row) and scan again for a fresh Active seat. Only the owner's
    /// own let-in answers his stop.</para>
    ///
    /// <para>Seats are ordered by when they were made (<see cref="GrantedAtUtc"/>): a person holds
    /// at most one live seat per farm, so a later seat was always made after the earlier one
    /// ended. Pure: no I/O.</para>
    /// </summary>
    public static bool HasUnansweredOwnerStop(IEnumerable<FarmMembership> seats)
    {
        ArgumentNullException.ThrowIfNull(seats);
        var history = seats.ToList();
        var lastStop = history
            .Where(s => s.EndedAfterOwnerStop)
            .OrderByDescending(s => s.GrantedAtUtc)
            .FirstOrDefault();

        return lastStop is not null
            && !history.Any(s => s.GrantedAtUtc > lastStop.GrantedAtUtc && s.WasLetInByOwner);
    }

    /// <summary>The longest owner reason stored (column <c>status_reason varchar(500)</c>).</summary>
    public const int MaxStatusReasonLength = 500;

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
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a request made by TYPING the farm's code
    /// (<see cref="CreateJoinRequest"/>), still waiting: <see cref="MembershipStatus.PendingApproval"/>
    /// and <see cref="JoinedVia.SelfJoin"/>. The one kind of seat the owner's QR may activate
    /// (<see cref="ActivateFromOwnerQr"/>), and the one kind a code rollback must end first
    /// (<c>Scripts/end-typed-code-join-requests.sql</c>).
    /// </summary>
    public bool IsTypedCodeJoinRequest =>
        Status == MembershipStatus.PendingApproval && JoinedVia == JoinedVia.SelfJoin;

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

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a person TYPED the farm's
    /// code and asks to join. The result is always
    /// <see cref="MembershipStatus.PendingApproval"/>, with no invitation behind
    /// it (<see cref="JoinedVia.SelfJoin"/>).
    ///
    /// <para><b>The joiner never chooses a role, so this factory does not take
    /// one.</b> <see cref="AppRole.Worker"/> is a placeholder that the owner
    /// replaces when approving (step 2); nothing a request body says can reach
    /// it. It grants nothing while the seat is PendingApproval: every role and
    /// member check counts <see cref="MembershipStatus.Active"/> seats only — in
    /// this release's code. Older binaries count any seat that has not ended, so
    /// a code rollback first ends these requests
    /// (<c>Scripts/end-typed-code-join-requests.sql</c>, doctrine E8).</para>
    /// </summary>
    public static FarmMembership CreateJoinRequest(
        Guid id,
        FarmId farmId,
        UserId userId,
        DateTime requestedAtUtc)
    {
        EnsureValidIds(id, farmId, userId);

        return new FarmMembership(
            id,
            farmId,
            userId,
            AppRole.Worker,
            MembershipStatus.PendingApproval,
            JoinedVia.SelfJoin,
            invitationId: null,
            requestedAtUtc);
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

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the owner's QR answers a person's earlier
    /// typed-code request. Scanning the owner's QR is the owner's own consent (the QR has no
    /// approval step, plan §5.1 Flow A), so the request becomes exactly what a fresh QR claim
    /// makes: an Active <see cref="AppRole.Worker"/> seat, joined via
    /// <see cref="JoinedVia.QrScan"/> under that QR's invitation. Without this, an unanswered
    /// request BLOCKED the QR (one live seat per person per farm), so the way in that works today
    /// answered "already requested" and left the worker outside.
    ///
    /// <para>Only <see cref="IsTypedCodeJoinRequest"/> moves. A PendingApproval seat from any other
    /// path (an invitation that requires approval, with a role the owner chose) is not approved
    /// by the farm-wide QR, and no other status is changed here.</para>
    /// </summary>
    public void ActivateFromOwnerQr(FarmInvitationId invitationId, DateTime utcNow)
    {
        if (!IsTypedCodeJoinRequest)
        {
            throw new InvalidOperationException(
                $"Membership '{Id}' is not a typed-code join request (status {Status}, joined via {JoinedVia}).");
        }

        if (invitationId.Value == Guid.Empty)
        {
            throw new ArgumentException("The QR's invitation id is required.", nameof(invitationId));
        }

        Status = MembershipStatus.Active;
        Role = AppRole.Worker;
        JoinedVia = JoinedVia.QrScan;
        InvitationId = invitationId;
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier SEC-MU2-1) — "exactly what a fresh
        // claim makes" includes nothing granted: a हजेरी व पक्कं grant or a stored permission left
        // on the waiting request (no path writes one now) never rides into the Active seat.
        CanManageLabourRecords = false;
        LabourGrantExpiresAtUtc = null;
        Permissions = null;
        ModifiedAtUtc = utcNow;
        LastSeenAtUtc = utcNow;
    }

    /// <summary>Legacy approve: the seat keeps the role and permissions it already carries.</summary>
    public void Approve(UserId approverUserId, DateTime utcNow) =>
        Approve(approverUserId, Role, Permissions, utcNow);

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner lets a waiting person in and, in
    /// the same tap, CHOOSES their role and permissions (plan §2 #5: the joiner never chooses). The
    /// placeholder role of a typed-code request is replaced here. Ownership itself
    /// (<see cref="AppRole.PrimaryOwner"/>) is never handed out by an approval.
    /// </summary>
    public void Approve(UserId approverUserId, AppRole role, FarmPermission? permissions, DateTime utcNow)
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

        if (role == AppRole.PrimaryOwner)
        {
            throw new ArgumentException("An approval never makes a primary owner.", nameof(role));
        }

        EnsureKnown(permissions);

        Status = MembershipStatus.Active;
        Role = role;
        Permissions = permissions;
        ApprovedByUserId = approverUserId;
        RecordDecision(approverUserId, reason: null, utcNow);
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner says "नको" to a waiting person.
    /// The request ends (<see cref="MembershipStatus.Revoked"/>) with the owner's reason; the row
    /// stays as history.
    /// </summary>
    public void Decline(UserId declinedByUserId, string? reason, DateTime utcNow)
    {
        if (Status is not (MembershipStatus.PendingApproval or MembershipStatus.PendingOtpClaim))
        {
            throw new InvalidOperationException(
                $"Only a waiting membership can be declined (current {Status}).");
        }

        RequireActor(declinedByUserId);
        var why = NormalizeReason(reason);
        Status = MembershipStatus.Revoked;
        RevokedAtUtc = utcNow;
        RecordDecision(declinedByUserId, why, utcNow);
    }

    /// <summary>Legacy pause with no actor or reason.</summary>
    public void Suspend(DateTime utcNow)
    {
        if (Status != MembershipStatus.Active)
        {
            throw new InvalidOperationException(
                $"Only Active memberships can be suspended (current {Status}).");
        }

        Status = MembershipStatus.Suspended;
        ModifiedAtUtc = utcNow;
        AccessChangedAtUtc = utcNow;
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner pauses this person's work ("काम
    /// थांबवा"): nothing new is read or written; history stays. The reason is shown to the person.
    /// </summary>
    public void Suspend(UserId suspendedByUserId, string? reason, DateTime utcNow)
    {
        RequireActor(suspendedByUserId);
        var why = NormalizeReason(reason);
        Suspend(utcNow);
        RecordDecision(suspendedByUserId, why, utcNow);
    }

    /// <summary>Legacy restore with no actor.</summary>
    public void Restore(DateTime utcNow)
    {
        if (Status != MembershipStatus.Suspended)
        {
            throw new InvalidOperationException(
                $"Only Suspended memberships can be restored (current {Status}).");
        }

        Status = MembershipStatus.Active;
        ModifiedAtUtc = utcNow;
        AccessChangedAtUtc = utcNow;
    }

    /// <summary>spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner lets a paused person work again.</summary>
    public void Restore(UserId restoredByUserId, DateTime utcNow)
    {
        RequireActor(restoredByUserId);
        Restore(utcNow);
        RecordDecision(restoredByUserId, reason: null, utcNow);
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner removes this person from the farm
    /// ("शेतातून काढा"), from Active or paused. Terminal; history stays. Invariant I3 holds: the
    /// last Active primary owner cannot be removed.
    /// </summary>
    public void Remove(UserId removedByUserId, string? reason, DateTime utcNow, bool isLastActivePrimaryOwner)
    {
        if (Status is not (MembershipStatus.Active or MembershipStatus.Suspended))
        {
            throw new InvalidOperationException(
                $"Only an Active or paused membership can be removed (current {Status}).");
        }

        RequireActor(removedByUserId);
        var why = NormalizeReason(reason);
        Revoke(utcNow, isLastActivePrimaryOwner);
        RecordDecision(removedByUserId, why, utcNow);
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the owner changes what this person is and
    /// may do: the role and/or the stored permission choice (<c>null</c> = the role's defaults).
    /// Returns <c>true</c> only when something actually moved — a re-sent request is not a
    /// decision and writes no history (the same rule as <see cref="SetLabourRecordManagement"/>).
    /// Only a live seat that has been let in (Active or paused) can be changed; a waiting request
    /// is answered with <see cref="Approve(UserId, AppRole, FarmPermission?, DateTime)"/>.
    /// </summary>
    public bool SetAccess(AppRole role, FarmPermission? permissions, UserId changedByUserId, DateTime utcNow)
    {
        if (Status is not (MembershipStatus.Active or MembershipStatus.Suspended))
        {
            throw new InvalidOperationException(
                $"Access can be changed only on an Active or paused membership (current {Status}).");
        }

        RequireActor(changedByUserId);
        EnsureKnown(permissions);

        if (Role == role && Permissions == permissions)
        {
            return false;
        }

        Role = role;
        Permissions = permissions;
        ModifiedAtUtc = utcNow;
        AccessChangedAtUtc = utcNow;
        return true;
    }

    /// <param name="reason">Already passed through <see cref="NormalizeReason"/> BEFORE the status
    /// moved, so a refused reason can never leave a half-applied decision.</param>
    private void RecordDecision(UserId byUserId, string? reason, DateTime utcNow)
    {
        StatusReason = reason;
        StatusChangedByUserId = byUserId;
        StatusChangedAtUtc = utcNow;
        AccessChangedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
    }

    /// <summary>Trims; blank = no reason; longer than the column = refused (never silently cut).</summary>
    public static string? NormalizeReason(string? reason)
    {
        var trimmed = reason?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > MaxStatusReasonLength)
        {
            throw new ArgumentException(
                $"A reason is at most {MaxStatusReasonLength} characters.", nameof(reason));
        }

        return trimmed;
    }

    private static void RequireActor(UserId byUserId)
    {
        if (byUserId.IsEmpty)
        {
            throw new ArgumentException("The deciding user is required.", nameof(byUserId));
        }
    }

    private static void EnsureKnown(FarmPermission? permissions)
    {
        if (permissions is { } value && !FarmPermissionDefaults.IsKnown(value))
        {
            throw new ArgumentException("Unknown permission bits.", nameof(permissions));
        }
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
        AccessChangedAtUtc = utcNow;
    }

    /// <summary>
    /// The person leaves (self-exit) — always allowed, from any live status (a waiting request is
    /// withdrawn, a paused seat is left), except the last Active primary owner (I3).
    ///
    /// <para>spec: plr-d7-m1-multiuser-2026-10-26 (step 2, SEC-2): leaving an ACTIVE or waiting seat
    /// records the person himself as the last decider. Leaving a PAUSED seat keeps the owner's pause
    /// (actor + reason) as the last decision, so <see cref="EndedAfterOwnerStop"/> still says the
    /// owner stopped this person — and the farm QR cannot hand him a fresh Active seat.</para>
    /// </summary>
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

        var wasPaused = Status == MembershipStatus.Suspended;
        Status = MembershipStatus.Exited;
        ExitedAtUtc = utcNow;
        ModifiedAtUtc = utcNow;
        AccessChangedAtUtc = utcNow;
        if (!wasPaused)
        {
            StatusChangedByUserId = UserId;
            StatusChangedAtUtc = utcNow;
            StatusReason = null;
        }
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
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — the grant opens attendance and log
        // approval, so it changes what this person may read and do (step 4 re-sends on it).
        AccessChangedAtUtc = utcNow;
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
