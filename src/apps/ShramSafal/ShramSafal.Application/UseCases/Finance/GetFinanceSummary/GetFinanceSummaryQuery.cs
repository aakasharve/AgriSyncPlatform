namespace ShramSafal.Application.UseCases.Finance.GetFinanceSummary;

public sealed record GetFinanceSummaryQuery(
    string GroupBy = "day",
    DateOnly? FromDate = null,
    DateOnly? ToDate = null);

