namespace ShramSafal.Application.Contracts.Dtos;

// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a). The response contract
// of GET /shramsafal/admin/mis/company. CR-2b reads exactly these records.
//
// Every number is a MisValueDto: Value is null exactly when NotMeasuredReason is
// given (doctrine P4: nothing is invented or defaulted). A true zero is Value 0.
// Series carry the current period only; Previous exists on MisNumberDto only.
// No phone number, person id or farm id appears anywhere in this answer.

public sealed record CompanyMisDto(
    DateTime CountedAtUtc,
    string TimeZone,
    MisRangeDto Range,
    MisRangeDto PreviousRange,
    int ExcludedTestAccounts,
    int FarmsListed,
    int FarmsNotReadable,
    MisOverviewDto Overview,
    MisAcquisitionDto Acquisition,
    MisEngagementDto Engagement,
    MisRetentionDto Retention,
    MisQualityDto Quality,
    MisFarmsDto Farms);

public sealed record MisRangeDto(DateOnly From, DateOnly To, int Days);

/// <summary>
/// Value == null exactly when NotMeasuredReason != null. Reasons:
/// "denominator_zero", "no_complete_window", "farm_list_unreadable",
/// "no_samples", "too_many_farms_for_live_count"; plan CR-2c adds "not_recorded"
/// (nothing records this yet, or not for the days asked about).
/// </summary>
public sealed record MisValueDto(decimal? Value, string? NotMeasuredReason);

/// <summary>
/// Amendment A9: CurrentByDay has one entry per India day of the range (day From
/// first), PreviousByDay one per day of the previous range. An entry is null when
/// that day's value is not measured, never 0. Both lists are null when the number
/// has no day-by-day form, and for farm-derived numbers when farm numbers are blocked.
/// </summary>
public sealed record MisNumberDto(
    MisValueDto Current,
    MisValueDto Previous,
    IReadOnlyList<decimal?>? CurrentByDay = null,
    IReadOnlyList<decimal?>? PreviousByDay = null);

public sealed record MisOverviewDto(
    MisNumberDto ActiveFarms,
    MisNumberDto SignUps,
    MisNumberDto Dau,
    MisNumberDto Wau,
    MisNumberDto Mau,
    MisNumberDto StickinessPct,
    MisNumberDto LogsRecorded,
    MisNumberDto VoiceLogs,
    MisNumberDto VoiceSharePct,
    IReadOnlyList<MisDayPointDto> SignUpsByDay,
    IReadOnlyList<MisDayPointDto> ActivePeopleByDay,
    IReadOnlyList<MisWeekSplitDto> LogsByWeek);

public sealed record MisAcquisitionDto(
    MisNumberDto Verified,
    MisNumberDto HasFarm,
    MisNumberDto FirstLog,
    MisNumberDto Habit,
    MisNumberDto HabitEligible);

/// <summary>WhenLogged always has 168 cells; WhenLoggedClock is always "server-arrival".</summary>
public sealed record MisEngagementDto(
    MisNumberDto LogsPerActiveFarmPerWeek,
    IReadOnlyList<MisHeatCellDto> WhenLogged,
    string WhenLoggedClock,
    IReadOnlyList<MisRoleCountDto> RoleMixOfMau);

public sealed record MisRetentionDto(
    MisNumberDto D1Pct,
    MisNumberDto D30Pct,
    MisNumberDto ActiveFarms0To6,
    MisNumberDto QuietFarms7To29,
    MisNumberDto SilentFarms30Plus,
    MisNumberDto NeverLoggedFarms,
    IReadOnlyList<MisCohortRowDto> CohortByWeek,
    IReadOnlyList<MisCurvePointDto> Curve,
    IReadOnlyList<MisDayPointDto> WinBackByDay,
    MisNumberDto QuietFarms7To13,
    MisNumberDto QuietFarms14To29,
    IReadOnlyList<MisCurvePointDto> PreviousCurve);

/// <summary>
/// Plan CR-2c: AppVersions (#52) is the current period only; AppVersionsSeenSince is the India day of
/// the first app.seen row the server wrote (null: none), so a period that starts earlier can say from
/// when people are known.
/// </summary>
public sealed record MisQualityDto(
    MisNumberDto VoiceRecordings,
    MisNumberDto VoiceRecordingsSavedPct,
    MisNumberDto TranscriptionAvgMs,
    MisNumberDto TranscriptionP95Ms,
    MisNumberDto LogsCorrected,
    MisNumberDto LogsCorrectedPct,
    MisListDto<MisVersionShareDto> AppVersions,
    DateOnly? AppVersionsSeenSince);

public sealed record MisFarmsDto(
    MisNumberDto ActiveFarms,
    MisNumberDto FarmsRegistered,
    MisNumberDto AcresCovered,
    MisNumberDto FarmsInFpo,
    IReadOnlyList<MisFpoRowDto> FarmsPerFpo,
    IReadOnlyList<MisAcresPointDto> AcresByWeek,
    MisNumberDto ActiveFarmsInFpoPct);

public sealed record MisDayPointDto(DateOnly Day, int Value);

public sealed record MisWeekSplitDto(DateOnly WeekStart, int Voice, int Typed, bool IsPartial);

/// <summary>Weekday 1 = Monday .. 7 = Sunday; Hour 0..23 in India time.</summary>
public sealed record MisHeatCellDto(int Weekday, int Hour, int Logs);

/// <summary>Role is an AppRole name, or "Unknown".</summary>
public sealed record MisRoleCountDto(string Role, int People);

/// <summary>
/// ActivePctByWeek has 4 entries (weeks 1..4); null = week not complete or no people.
/// ActivePctOnDays (A11) has 4 entries for days 1, 7, 14 and 30 after day 0; null = nobody eligible.
/// </summary>
public sealed record MisCohortRowDto(
    DateOnly WeekStart, int People, IReadOnlyList<decimal?> ActivePctByWeek, IReadOnlyList<decimal?> ActivePctOnDays);

/// <summary>Day 0..30; ActivePct null when Eligible is 0.</summary>
public sealed record MisCurvePointDto(int Day, decimal? ActivePct, int Eligible);

public sealed record MisFpoRowDto(string OrganizationName, int Farms);

public sealed record MisAcresPointDto(DateOnly Day, decimal Acres);

// ---- plan CR-2c (the answer additions) ----

/// <summary>
/// A list for the current period. NotMeasuredReason != null means the list could not be counted
/// (Items is then empty); an empty list with no reason is a real "none in this period".
/// </summary>
public sealed record MisListDto<T>(IReadOnlyList<T> Items, string? NotMeasuredReason);

/// <summary>
/// #52: people seen in the period, each once, on the version of their most recent app.seen row.
/// Platform is "android" (the native Android app) or "not_android" (no platform recorded: a browser,
/// or an app build that does not say). SharePct = People of all people counted, one decimal.
/// </summary>
public sealed record MisVersionShareDto(string Version, string Platform, int People, decimal SharePct);
