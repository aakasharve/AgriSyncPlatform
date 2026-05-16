using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.AssignJobCard;

/// <summary>
/// Assigns a JobCard to a worker. CEI Phase 4 §4.8 — Task 2.1.2.
/// </summary>
public sealed record AssignJobCardCommand(
    Guid JobCardId,
    UserId WorkerUserId,
    UserId CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
