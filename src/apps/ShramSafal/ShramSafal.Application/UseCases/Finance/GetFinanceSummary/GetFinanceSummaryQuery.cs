namespace ShramSafal.Application.UseCases.Finance.GetFinanceSummary;

public sealed record GetFinanceSummaryQuery(
    Guid ActorUserId,
    string GroupBy = "day",
    DateOnly? FromDate = null,
    DateOnly? ToDate = null);
