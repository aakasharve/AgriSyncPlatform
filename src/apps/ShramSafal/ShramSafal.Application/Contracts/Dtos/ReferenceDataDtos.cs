namespace ShramSafal.Application.Contracts.Dtos;

public sealed record StageDefinitionDto(
    string Name,
    int StartDay,
    int EndDay);

public sealed record TemplateActivityDto(
    string Name,
    string Category,
    string StageName,
    int StartDay,
    int EndDay,
    string FrequencyMode,
    int? IntervalDays,
    // spec: plr-d10 lane SCH-A (Task 1) - additive at the END and optional (P11: release 1.0.17 keeps parsing the library).
    // Set only for a row that STORES its days; null for a built-in sample and for a thin row, so a reader never mistakes the
    // in-memory default for a stored value.
    string? OperationKey = null,
    Guid? Id = null,
    string? Part = null,
    string? Role = null,
    string? NutrientKey = null,
    Guid? AfterActivityId = null,
    string? StoredFrequencyMode = null);

/// <summary>
/// spec: plr-d10 lane SCH-A - ShramSafal's check of a library row. <c>State</c> is
/// <c>Checked | NotChecked | Returned | Withdrawn</c> (the row's LATEST decision).
/// </summary>
public sealed record ScheduleCheckDto(
    string State,
    string? CheckerDisplayName,
    DateTime? CheckedAtUtc,
    string? Note);

public sealed record ScheduleTemplateDto(
    Guid Id,
    string Name,
    string CropType,
    int TotalDays,
    IReadOnlyList<StageDefinitionDto> Stages,
    IReadOnlyList<TemplateActivityDto> Activities,
    string VersionHash,
    // spec: plr-d10 lane SCH-A (Task 1) - additive at the END and optional (P11). OwnerType is on the wire as
    // INSTITUTION | EXPERT | USER | SYSTEM_DEFAULT; RowVersionTag is this row's own "v<Version>" (the list hash above stays
    // for old phones); HasStoredDays is true only for a row whose stages and activities store their days.
    string? OwnerType = null,
    string? SourceLabel = null,
    ScheduleCheckDto? Check = null,
    string? RowVersionTag = null,
    bool? HasStoredDays = null,
    // spec: plr-d10 lane L8b-1F - additive at the END and optional (P11). Whose row this is: Public | Team | Private | Licensed; null =
    // a built-in sample (Public). The phone offers only Public/null rows for a plot to follow until SCH-OWN opens the Own branch.
    string? Scope = null);

public sealed record CropTypeDto(
    string Name,
    IReadOnlyList<string> Stages,
    Guid? DefaultTemplateId);
