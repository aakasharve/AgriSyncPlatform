namespace ShramSafal.Application.Contracts.Dtos;

public sealed record WvfdHistoryDto(
    decimal CurrentWvfd,
    decimal? PriorWvfd,
    decimal GoalWvfd,
    IReadOnlyList<WvfdWeekDto> Weeks,
    IReadOnlyList<WvfdFarmRowDto> TopFarms);

public sealed record WvfdWeekDto(
    DateOnly WeekStart,
    decimal AvgWvfd,
    int ActiveFarms);

public sealed record WvfdFarmRowDto(
    Guid FarmId,
    decimal Wvfd,
    string EngagementTier,
    int ActiveFarms);
