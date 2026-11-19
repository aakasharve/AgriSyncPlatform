namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C12). Confirmed farm-days,
/// counted live on request by <c>ConfirmedFarmDays</c> over India weeks (Monday to Sunday).
/// <para>
/// <see cref="CurrentWvfd"/> is the average checked days per active farm in the last COMPLETE India week ("last
/// week"); <see cref="PriorWvfd"/> the same for the week before it; <see cref="CurrentSelfOnlyDays"/> the average
/// self-only days per active farm last week, shown apart and never added in (D-151 b). Each is null when that week
/// had no active farm, never 0. <see cref="GoalWvfd"/> is always null: no goal is set (W5, D-151 b).
/// </para>
/// <para>
/// <see cref="Weeks"/> holds the chosen number of complete weeks, oldest first, then the current week so far
/// (<see cref="WvfdWeekDto.IsPartial"/> true). <see cref="Farms"/> lists EVERY farm with a counted entry last week.
/// </para>
/// <para>
/// <see cref="NotMeasuredReason"/> is null when the numbers are real. Otherwise every number is null, both lists are
/// empty and the reason is <c>"too_many_farms_for_live_count"</c> (above the live-count ceiling, nothing per farm was
/// read) or <c>"farm_list_unreadable"</c> (no farm listed, or a farm could not be read, so a number would be
/// partial).
/// </para>
/// </summary>
public sealed record WvfdHistoryDto(
    decimal? CurrentWvfd,
    decimal? CurrentSelfOnlyDays,
    decimal? PriorWvfd,
    decimal? GoalWvfd,
    IReadOnlyList<WvfdWeekDto> Weeks,
    IReadOnlyList<WvfdFarmRowDto> Farms,
    DateTime CountedAtUtc,
    string? NotMeasuredReason);

/// <summary>
/// One India week starting Monday <see cref="WeekStart"/>. <see cref="ActiveFarms"/> is the farms with at least one
/// counted entry that week. <see cref="AvgWvfd"/> is the sum over those farms of their checked days (at most 7) divided
/// by <see cref="ActiveFarms"/>, rounded to 2 places; <see cref="AvgSelfOnlyDays"/> the same for self-only days. Both
/// are null, never 0, when <see cref="ActiveFarms"/> is 0. <see cref="IsPartial"/> marks the current week so far.
/// </summary>
public sealed record WvfdWeekDto(
    DateOnly WeekStart,
    decimal? AvgWvfd,
    decimal? AvgSelfOnlyDays,
    int ActiveFarms,
    bool IsPartial);

/// <summary>
/// One farm with a counted entry last complete week: its checked days (at most 7), its self-only days, and its tier by
/// checked days (A: 5 or more, B: 3-4, C: 1-2, D: none).
/// </summary>
public sealed record WvfdFarmRowDto(
    Guid FarmId,
    int CheckedDays,
    int SelfOnlyDays,
    string EngagementTier);
