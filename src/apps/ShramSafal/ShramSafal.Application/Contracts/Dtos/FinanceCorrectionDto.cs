namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FinanceCorrectionDto(
    Guid Id,
    Guid CostEntryId,
    decimal OriginalAmount,
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason,
    Guid CorrectedByUserId,
    DateTime CorrectedAtUtc);

