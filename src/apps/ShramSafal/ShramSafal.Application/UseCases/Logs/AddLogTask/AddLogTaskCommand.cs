using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

public sealed record AddLogTaskCommand(
    Guid DailyLogId,
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null,
    Guid? LogTaskId = null,
    Guid ActorUserId = default,
    string? ActorRole = null,
    string? ClientCommandId = null,
    ExecutionStatus ExecutionStatus = ExecutionStatus.Completed,
    string? DeviationReasonCode = null,
    string? DeviationNote = null,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for the
    // emitted AuditEvent row. Sourced from HttpContext.AuditClaims() at the
    // endpoint; sentinel defaults keep direct-construction tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
