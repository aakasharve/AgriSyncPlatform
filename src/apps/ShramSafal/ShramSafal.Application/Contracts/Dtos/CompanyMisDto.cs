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

/// <summary>
/// Plan CR-2c (#10, amendment E4): UnderstandingMedian is the middle score out of 10 of the period's scored
/// farm-days, one decimal; UnderstandingScoredDays is how many there are. A scored farm-day has a stored day and a
/// score and is not a declared no-work day; a computed 0 counts. No scored farm-day: both "no_samples".
/// </summary>
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
    IReadOnlyList<MisWeekSplitDto> LogsByWeek,
    MisNumberDto UnderstandingMedian,
    MisNumberDto UnderstandingScoredDays);

public sealed record MisAcquisitionDto(
    MisNumberDto Verified,
    MisNumberDto HasFarm,
    MisNumberDto FirstLog,
    MisNumberDto Habit,
    MisNumberDto HabitEligible);

/// <summary>
/// WhenLogged always has 168 cells; WhenLoggedClock is always "server-arrival". Plan CR-2c (#29, #31), the current
/// period only: FeatureUse has one item per feature key (entries, voice, costs, attendance, photos, job_cards,
/// compare); FeatureUseByRole one item per (feature, role) somebody used it in; LogsByKind (#26) one item per kind
/// (water, nutrition, spray, other_work, labour, not_recognised), zeros real.
/// </summary>
public sealed record MisEngagementDto(
    MisNumberDto LogsPerActiveFarmPerWeek,
    IReadOnlyList<MisHeatCellDto> WhenLogged,
    string WhenLoggedClock,
    IReadOnlyList<MisRoleCountDto> RoleMixOfMau,
    MisListDto<MisFeatureUseDto> FeatureUse,
    MisListDto<MisFeatureRoleDto> FeatureUseByRole,
    MisListDto<MisKindCountDto> LogsByKind);

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
/// Plan CR-2c: UnderstandingSpread (#49) is the scored farm-days of the current period per score 0..10, all eleven
/// present (zeros real), or "no_samples" when there is none. Sync (#47, #50, amendment E2): SyncRefusedChanges =
/// refused attempts (a change refused twice counts twice), SyncAcceptedChanges = changes the server accepted,
/// SyncRefusedPct = refused ÷ (refused + accepted); every upload counts, test accounts included; refused and the
/// share are "not_recorded" for a period that starts before refusals were recorded in production; nothing sent
/// is "denominator_zero"; the day chart reads their CurrentByDay (E8). AppVersions (#52) is the current period
/// only; AppVersionsSeenSince is the India day of the first app.seen row the server wrote (null: none), so a
/// period that starts earlier can say from when people are known.
/// </summary>
public sealed record MisQualityDto(
    MisNumberDto VoiceRecordings,
    MisNumberDto VoiceRecordingsSavedPct,
    MisNumberDto TranscriptionAvgMs,
    MisNumberDto TranscriptionP95Ms,
    MisNumberDto LogsCorrected,
    MisNumberDto LogsCorrectedPct,
    MisListDto<MisScoreBucketDto> UnderstandingSpread,
    MisNumberDto SyncRefusedChanges,
    MisNumberDto SyncAcceptedChanges,
    MisNumberDto SyncRefusedPct,
    MisListDto<MisVersionShareDto> AppVersions,
    DateOnly? AppVersionsSeenSince);

/// <summary>Plan CR-2c (#59): CropsOnActiveFarms is the current period only.</summary>
public sealed record MisFarmsDto(
    MisNumberDto ActiveFarms,
    MisNumberDto FarmsRegistered,
    MisNumberDto AcresCovered,
    MisNumberDto FarmsInFpo,
    IReadOnlyList<MisFpoRowDto> FarmsPerFpo,
    IReadOnlyList<MisAcresPointDto> AcresByWeek,
    MisNumberDto ActiveFarmsInFpoPct,
    MisListDto<MisCropRowDto> CropsOnActiveFarms);

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

/// <summary>#49: FarmDays = scored farm-days of the period with this score (0..10).</summary>
public sealed record MisScoreBucketDto(int Score, int FarmDays);

/// <summary>
/// #29: People = distinct people who used the feature in the period; SharePct = of the distinct people who did any
/// counted thing in the period (so no share exceeds 100). Nobody did anything counted: People 0, SharePct null,
/// "denominator_zero". Compare is not recorded anywhere: People and SharePct null, "not_recorded".
/// </summary>
public sealed record MisFeatureUseDto(string Feature, int? People, decimal? SharePct, string? NotMeasuredReason);

/// <summary>#31: People = distinct people who used the feature in the period holding this role on the farm where
/// they used it (an AppRole name, or "Unknown"); a person counts once per (feature, role).</summary>
public sealed record MisFeatureRoleDto(string Feature, string Role, int People);

/// <summary>
/// #59: one crop name (grouped trimmed and lower-cased; shown with its most common spelling) on the farms active at
/// the end of the period: Farms = farms with at least one such cycle; Acres = the sum of the distinct plots' areas
/// under such cycles (a plot with two crops counts for both).
/// </summary>
public sealed record MisCropRowDto(string CropName, int Farms, decimal Acres);

/// <summary>
/// #26: Entries = entries saved in the period that have this kind. An entry's kinds are its task lines read by the
/// app's own work-word list (the one Compare uses), plus "labour" when saved at the हजेरी door; it counts once per
/// distinct kind, so one entry can count under two kinds.
/// </summary>
public sealed record MisKindCountDto(string Kind, int Entries);

/// <summary>
/// #52: people seen in the period, each once, on the version of their most recent app.seen row.
/// Platform is "android" (the native Android app) or "not_android" (no platform recorded: a browser,
/// or an app build that does not say). SharePct = People of all people counted, one decimal.
/// </summary>
public sealed record MisVersionShareDto(string Version, string Platform, int People, decimal SharePct);
