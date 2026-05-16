using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

/// <summary>
/// Completes a JobCard and links it to a DailyLog. CEI Phase 4 §4.8 — Task 2.1.4.
/// </summary>
public sealed record CompleteJobCardCommand(
    Guid JobCardId,
    Guid DailyLogId,
    UserId CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
