namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// Output DTO representing a JobCard for query responses and sync pull.
/// CEI Phase 4 §4.8 — Work Trust Ledger.
/// </summary>
public sealed record JobCardDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    Guid CreatedByUserId,
    Guid? AssignedWorkerUserId,
    string? AssignedWorkerDisplayName,
    DateOnly PlannedDate,
    string Status,
    IReadOnlyList<JobCardLineItemDto> LineItems,
    decimal EstimatedTotalAmount,
    string EstimatedTotalCurrency,
    Guid? LinkedDailyLogId,
    Guid? PayoutCostEntryId,
    string? CancellationReason,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
