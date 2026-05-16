using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.UseCases.Work.CreateJobCard;

/// <summary>
/// Creates a new JobCard in Draft status. CEI Phase 4 §4.8 — Task 2.1.1.
/// </summary>
public sealed record CreateJobCardCommand(
    FarmId FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    DateOnly PlannedDate,
    IReadOnlyList<JobCardLineItemDto> LineItems,
    UserId CallerUserId,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. Default sentinels
    // keep direct-construction unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
