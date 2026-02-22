namespace ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;

public sealed record GetPlotFinanceSummaryQuery(
    Guid PlotId,
    DateOnly? FromDate = null,
    DateOnly? ToDate = null);
