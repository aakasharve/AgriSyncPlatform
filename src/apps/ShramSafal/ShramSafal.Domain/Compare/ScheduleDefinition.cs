using ShramSafal.Domain.Planning;

namespace ShramSafal.Domain.Compare;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-E; R28, R33, R34)

/// <summary>
/// A schedule as the engine reads it: its stages and its activities with the days the schedule STORES. Plain Domain
/// input (no Application type, E2); SCH-GATE's mapper builds it from the stored fields later.
/// </summary>
/// <param name="EndsOnSign">
/// spec: plr-d10 schedule slice 3 - for each stage of <paramref name="Stages"/> (same place in the list), whether it ENDS ON A SIGN: its end day is then an
/// expectation and the stage stays open until its sign (the stage line holds it past that day, see <c>ScheduleDefinitionMapper.StageHolding</c>).
/// <c>null</c> (every schedule before the task format) = no stage ends on a sign: exactly the old windows.
/// </param>
public sealed record ScheduleDefinition(
    Guid TemplateId,
    string Name,
    IReadOnlyList<StageDefinition> Stages,
    IReadOnlyList<ScheduleActivityDef> Activities,
    IReadOnlyList<bool>? EndsOnSign = null);

/// <summary>
/// One activity of a schedule. <see cref="EndDay"/> / <see cref="FrequencyMode"/> / <see cref="IntervalDays"/> null = not
/// stored. An activity with no <see cref="EndDay"/>, no <see cref="Part"/> or no <see cref="FrequencyMode"/> has no days
/// the engine may use: it expands to nothing (P4, never a guess from its words). <see cref="Part"/> is one of
/// <c>irrigation | nutrition | spray | work</c>. <see cref="Role"/> / <see cref="NutrientKey"/> / <see cref="OperationKey"/>,
/// when stored, overrule what the title alone says.
/// <para>spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6) - <see cref="TaskKey"/>: the permanent key of the task-format work this activity was written
/// from (null for the old format); a record LINKED to that key (a plan of the work completed with it) counts for exactly this activity, whatever its words.
/// <see cref="StageUnknown"/>: a work with no day, no expectation and no stage of its own: it sits in no window and counts only its linked records.</para>
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
    Guid? AfterActivityId,
    string? TaskKey = null,
    bool StageUnknown = false);

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
    Guid? AfterActivityId,
    string? TaskKey = null);

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

/// <param name="StageUnknown">
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6) - the works of this schedule that hold no day, no expectation and no stage (<see cref="ScheduleActivityDef.StageUnknown"/>):
/// they ask no number (Asked null) and count only the records LINKED to them (a plan of that work completed with a record). Null when the schedule has none.
/// </param>
public sealed record ScheduleFollowResult(
    short Slot,
    Guid TemplateId,
    IReadOnlyList<StageCount> Stages,
    IReadOnlyList<OrderNote> Order,
    StageCount? StageUnknown = null);

/// <summary>A recognised record of work none of the followed schedules asks in that window. <see cref="RecordIndex"/> points into the caller's list.</summary>
public sealed record OwnWorkItem(int RecordIndex, string StageName, IReadOnlyList<string> MatchedWords);

/// <summary>A record the work recogniser could not read (R12). Never counted as anything else.</summary>
public sealed record NotRecognisedItem(int RecordIndex, string StageName);

public sealed record PlotFollowResult(
    IReadOnlyList<ScheduleFollowResult> Schedules,
    IReadOnlyList<OwnWorkItem> OwnWork,
    IReadOnlyList<NotRecognisedItem> NotRecognised);
