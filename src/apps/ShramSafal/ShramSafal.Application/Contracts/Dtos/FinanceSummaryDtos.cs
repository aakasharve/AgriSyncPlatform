namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FinanceSummaryItemDto(
    string GroupKey,
    decimal TotalAmount,
    int EntriesCount,
    int CorrectionsCount);

public sealed record FinanceSummaryDto(
    string GroupBy,
    DateOnly? FromDate,
    DateOnly? ToDate,
    string CurrencyCode,
    decimal GrandTotal,
    IReadOnlyList<FinanceSummaryItemDto> Items,
    // lane MU-3 fix 1 (F11) — how many of the caller's farms this summary does NOT count because their money
    // is not shown to him (0 = every farm he works on is counted). Additive: absent on an older server.
    int FarmsNotCounted = 0);

