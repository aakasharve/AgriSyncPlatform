using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.VerifyLog;

public sealed record VerifyLogCommand(
    Guid DailyLogId,
    VerificationStatus TargetStatus,
    string? Reason,
    Guid VerifiedByUserId,
    Guid? VerificationEventId = null,
    string? ActorRole = null,
    string? ClientCommandId = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
    // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
