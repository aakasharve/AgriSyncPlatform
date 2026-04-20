namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlotFinanceSummaryDto(
    Guid PlotId,
    DateOnly? FromDate,
    DateOnly? ToDate,
    decimal DirectCosts,
    decimal AllocatedCosts,
    decimal TotalCosts);
