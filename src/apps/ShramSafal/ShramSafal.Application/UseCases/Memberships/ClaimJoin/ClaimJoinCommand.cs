using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Memberships.ClaimJoin;

public sealed record ClaimJoinCommand(
    string Token,
    string FarmCode,
    UserId CallerUserId,
    bool PhoneVerified,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
    // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");

/// <param name="Status">spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — ADDITIVE, last: the
/// seat's real status. A fresh QR claim is <c>Active</c>, and so is a typed-code request the QR
/// just answered; but the already-a-member answer returns any other EXISTING seat as it is, and
/// that seat can be paused (<c>Suspended</c>). The join page must not call that "joined".</param>
public sealed record ClaimJoinResult(
    Guid MembershipId,
    FarmId FarmId,
    string FarmName,
    string Role,
    bool WasAlreadyMember,
    MembershipStatus Status = MembershipStatus.Active);
