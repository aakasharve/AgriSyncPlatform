namespace ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;

public sealed record GetPlotFinanceSummaryQuery(
    Guid ActorUserId,
    Guid PlotId,
    DateOnly? FromDate = null,
    DateOnly? ToDate = null);
