namespace ShramSafal.Application.Contracts.Dtos;

public sealed record DayLedgerAllocationDto(
    Guid Id,
    Guid PlotId,
    decimal AllocatedAmount,
    string CurrencyCode,
    DateTime AllocatedAtUtc);
