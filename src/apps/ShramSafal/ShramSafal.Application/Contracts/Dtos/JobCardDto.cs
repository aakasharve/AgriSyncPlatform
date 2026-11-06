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
    // lane MU-3 fix 1 (F7) — the OUTPUT line (its rate may be withheld); the input stays JobCardLineItemDto.
    IReadOnlyList<JobCardLineItemViewDto> LineItems,
    // lane MU-3 fix 1 (F4 / F7) — a worker's pay: null = WITHHELD from this reader (no see wages), never ₹0.
    decimal? EstimatedTotalAmount,
    string EstimatedTotalCurrency,
    Guid? LinkedDailyLogId,
    Guid? PayoutCostEntryId,
    string? CancellationReason,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc,
    // lane L4b fix round 1 (H-1 / CTO D-89) — the linked record's verification state ("Draft", "Verified", "Disputed",
    // …) as the farm's job-card list reads it, so the phone offers "पेआउट तपासा" only where the server would let it
    // pass. null = no linked record, a record kept from this reader, or a read that does not fill it (the sync pull).
    string? LinkedDailyLogStatus = null,
    // lane L4b fix round 1 (M-2) — a शंका or a correction took this card back from "ready to pay" and its payout
    // check has not been done again. Filled by the farm's job-card list; false elsewhere.
    bool PayoutCheckWithdrawn = false);

/// <summary>
/// lane MU-3 fix 1 (F7) — one job-card line as a READER receives it. <see cref="RatePerHourAmount"/> is a
/// worker's pay: <c>null</c> = withheld from this reader (no see wages), never ₹0. The input (a card being
/// created) keeps <see cref="JobCardLineItemDto"/>, whose rate is required.
/// </summary>
public sealed record JobCardLineItemViewDto(
    string ActivityType,
    decimal ExpectedHours,
    decimal? RatePerHourAmount,
    string RatePerHourCurrencyCode,
    string? Notes);
