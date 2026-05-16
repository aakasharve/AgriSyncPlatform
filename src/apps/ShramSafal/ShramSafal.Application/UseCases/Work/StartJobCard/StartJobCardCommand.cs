using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// Marks a JobCard as started (InProgress). CEI Phase 4 §4.8 — Task 2.1.3.
/// Only the assigned worker may call this.
/// </summary>
public sealed record StartJobCardCommand(
    Guid JobCardId,
    UserId CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
