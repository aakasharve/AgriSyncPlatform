using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-E; R28, R33, R34)

/// <summary>
/// A schedule as the engine reads it: its stages and its activities with the days the schedule STORES. Plain Domain
/// input (no Application type, E2); SCH-GATE's mapper builds it from the stored fields later.
/// </summary>
public sealed record ScheduleDefinition(
    Guid TemplateId,
    string Name,
    IReadOnlyList<StageDefinition> Stages,
    IReadOnlyList<ScheduleActivityDef> Activities);

/// <summary>
/// One activity of a schedule. <see cref="EndDay"/> / <see cref="FrequencyMode"/> / <see cref="IntervalDays"/> null = not
/// stored. An activity with no <see cref="EndDay"/>, no <see cref="Part"/> or no <see cref="FrequencyMode"/> has no days
/// the engine may use: it expands to nothing (P4, never a guess from its words). <see cref="Part"/> is one of
/// <c>irrigation | nutrition | spray | work</c>. <see cref="Role"/> / <see cref="NutrientKey"/> / <see cref="OperationKey"/>,
/// when stored, overrule what the title alone says.
/// </summary>
public sealed record ScheduleActivityDef(
    Guid ActivityId,
    string Title,
    string? Part,
    string? OperationKey,
    string? Role,
    string? NutrientKey,
    int StartDay,
    int? EndDay,
    FrequencyMode? FrequencyMode,
    int? IntervalDays,
    Guid? AfterActivityId);

/// <summary>A stage as dates (both ends included).</summary>
public sealed record StageWindow(string Name, DateOnly From, DateOnly To);

/// <summary>One dated step the schedule stores. <see cref="OnceOnly"/> is true only when the frequency is STORED OneTime.</summary>
public sealed record ExpectedStep(
    Guid ActivityId,
    string Part,
    string? OperationKey,
    string Title,
    DateOnly Date,
    bool OnceOnly,
    string? Role,
    string? NutrientKey);

/// <summary>What one activity asks inside one window. <see cref="Dates"/> / <see cref="TimesInStage"/> null = the days are not stored (words only).</summary>
public sealed record StageActivityPlan(
    Guid ActivityId,
    string Part,
    string Title,
    string? OperationKey,
    FrequencyMode? FrequencyMode,
    int? IntervalDays,
    IReadOnlyList<DateOnly>? Dates,
    int? TimesInStage,
    Guid? AfterActivityId);

/// <summary>A schedule the plot follows, with its own day zero.</summary>
public sealed record FollowedSchedule(short Slot, ScheduleDefinition Schedule, DateOnly DayZero);

/// <summary>
/// One activity's count inside one window. <see cref="Asked"/> / <see cref="NotYet"/> are null when the days are not
/// stored; <see cref="Done"/> is then the records that came for it. <see cref="SaidNotDone"/> never exceeds <see cref="NotYet"/>.
/// </summary>
public sealed record ActivityCount(
    Guid ActivityId,
    string Part,
    string Title,
    int? Asked,
    int Done,
    int? NotYet,
    int SaidNotDone,
    int MoreThanAsked);

public enum StageState
{
    Passed = 0,
    Current = 1,
    Ahead = 2,
}

/// <summary>One window of one schedule. An Ahead window carries no numbers. Totals sum ONLY activities whose days are stored.</summary>
public sealed record StageCount(
    string Name,
    StageState State,
    int? Asked,
    int? Done,
    int? NotYet,
    int? DaysLeft,
    IReadOnlyList<ActivityCount> Activities);

/// <summary>The schedule stores that <see cref="FirstActivityId"/> comes before <see cref="ThenActivityId"/>, and the later work was recorded first (or alone).</summary>
public sealed record OrderNote(Guid FirstActivityId, Guid ThenActivityId, DateOnly? FirstDay, DateOnly ThenDay);

public sealed record ScheduleFollowResult(
    short Slot,
    Guid TemplateId,
    IReadOnlyList<StageCount> Stages,
    IReadOnlyList<OrderNote> Order);

/// <summary>A recognised record of work none of the followed schedules asks in that window. <see cref="RecordIndex"/> points into the caller's list.</summary>
public sealed record OwnWorkItem(int RecordIndex, string StageName, IReadOnlyList<string> MatchedWords);

/// <summary>A record the work recogniser could not read (R12). Never counted as anything else.</summary>
public sealed record NotRecognisedItem(int RecordIndex, string StageName);

public sealed record PlotFollowResult(
    IReadOnlyList<ScheduleFollowResult> Schedules,
    IReadOnlyList<OwnWorkItem> OwnWork,
    IReadOnlyList<NotRecognisedItem> NotRecognised);
