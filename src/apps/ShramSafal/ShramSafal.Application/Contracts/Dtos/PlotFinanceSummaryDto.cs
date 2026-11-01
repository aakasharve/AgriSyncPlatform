namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlotFinanceSummaryDto(
    Guid PlotId,
    DateOnly? FromDate,
    DateOnly? ToDate,
    decimal DirectCosts,
    decimal AllocatedCosts,
    decimal TotalCosts,
    // spec: plr-d10 lane PRV — money records (and day-ledger rows made from them) this total leaves out by rule (W4).
    int RecordsNotCounted = 0);
