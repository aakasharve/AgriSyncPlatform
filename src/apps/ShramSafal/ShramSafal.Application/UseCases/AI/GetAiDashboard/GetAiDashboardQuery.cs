namespace ShramSafal.Application.UseCases.AI.GetAiDashboard;

public sealed record GetAiDashboardQuery(
    DateTime? SinceUtc = null,
    int RecentJobsLimit = 25);
