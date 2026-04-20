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
    int? IntervalDays);

public sealed record ScheduleTemplateDto(
    Guid Id,
    string Name,
    string CropType,
    int TotalDays,
    IReadOnlyList<StageDefinitionDto> Stages,
    IReadOnlyList<TemplateActivityDto> Activities,
    string VersionHash);

public sealed record CropTypeDto(
    string Name,
    IReadOnlyList<string> Stages,
    Guid? DefaultTemplateId);
