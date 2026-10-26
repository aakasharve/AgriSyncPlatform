// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.JoinByCode;

/// <summary>
/// A signed-in person typed a farm's code to ask to join it. There is deliberately no role
/// field: the joiner never chooses one (the owner does, when approving).
/// </summary>
public sealed record JoinByCodeCommand(
    string FarmCode,
    UserId CallerUserId,
    bool PhoneVerified,
    // Forensic provenance for the audit row, sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green (same as ClaimJoin).
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

/// <summary>
/// <paramref name="Status"/> is the REAL status of the caller's live seat on the farm:
/// <see cref="MembershipStatus.PendingApproval"/> for a new request, or whatever an existing
/// seat already holds (Active / PendingApproval / Suspended; a PendingOtpClaim seat is answered
/// as PendingApproval, the contract's waiting state). <paramref name="WasAlreadyMember"/>
/// is true when nothing was written.
/// </summary>
public sealed record JoinByCodeResult(
    FarmId FarmId,
    string FarmName,
    MembershipStatus Status,
    bool WasAlreadyMember);
