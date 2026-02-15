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
    IReadOnlyList<FinanceSummaryItemDto> Items);

