namespace ShramSafal.Application.Contracts.Dtos;

public sealed record CostEntryDto(
    Guid Id,
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId,
    DateTime CreatedAtUtc,
    bool IsCorrected,
    bool IsFlagged,
    string? FlagReason);
