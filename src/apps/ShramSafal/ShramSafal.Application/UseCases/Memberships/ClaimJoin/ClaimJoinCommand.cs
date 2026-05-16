using AgriSync.SharedKernel.Contracts.Ids;

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

public sealed record ClaimJoinResult(
    Guid MembershipId,
    FarmId FarmId,
    string FarmName,
    string Role,
    bool WasAlreadyMember);
