namespace ShramSafal.Application.Contracts.Dtos;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-a; D-83 = 1, D-99, R28, R34, P4, P11)

/// <summary>
/// What the server says about the schedule stage of one plot: the stage window (the मुख्य schedule's, R28), and what each
/// followed schedule asks inside it. Nothing here is a done count or a quantity (P4): the numbers are the days the schedules
/// STORE, expanded by the one engine. <see cref="NeedsSchedule"/> true = nothing is counted (the phone asks him to choose first).
/// </summary>
public sealed record PlotStagePlanDto(
    DateTime ServerTimeUtc,
    Guid PlotId,
    bool NeedsSchedule,
    StagePlanWindowDto? Stage,
    IReadOnlyList<StagePlanScheduleDto> Schedules);

/// <summary>The stage window: its name, its days on the मुख्य schedule's count, and the plot's day today on that same count.</summary>
public sealed record StagePlanWindowDto(string Name, int StartDay, int EndDay, int DayToday);

/// <summary>
/// One followed schedule. <see cref="Slot"/> 1..3 = outside, 0 = his own, null = it holds no place (written by a binary that sets none -
/// never shown as a place it does not hold, P4). <see cref="Check"/> is null for his own (D-82 = 3: it is never shown as checked or waiting).
/// </summary>
public sealed record StagePlanScheduleDto(
    Guid SubscriptionId,
    Guid TemplateId,
    string Name,
    short? Slot,
    string Origin,
    bool IsMain,
    ScheduleCheckDto? Check,
    IReadOnlyList<StagePlanItemDto> Items);

/// <summary>
/// One work a schedule asks inside the window. <see cref="FrequencyMode"/> / <see cref="IntervalDays"/> are the STORED repeat
/// (the phone words it in the reader's language); <see cref="Days"/> are the dates minus the मुख्य day 0, and
/// <see cref="TimesInStage"/> their count - both null exactly when the days are not stored. <see cref="AfterTitle"/> is the title
/// of the work this one must follow, when the schedule stores an order (R34).
/// </summary>
public sealed record StagePlanItemDto(
    Guid ActivityId,
    string Part,
    string Title,
    string? OperationKey,
    string? FrequencyMode,
    int? IntervalDays,
    IReadOnlyList<int>? Days,
    int? TimesInStage,
    string? AfterTitle);

/// <summary>
/// spec: plr-d10 lane SCH-GATE-a - what the planning gate says about one plot, as the pull sends it (full on every pull; the
/// trial ends with no row changing). Read by planning, the शेड्यूल page and तुलना only; never by a record door (D-83 = 1).
/// </summary>
public sealed record PlotPlanningStateDto(
    Guid PlotId,
    Guid? CropCycleId,
    bool InTrial,
    bool FollowsAllowed,
    bool CanFollowSomething,
    StageDefinitionDto? TrialStage,
    bool NeedsSchedule);
