namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlannedVsExecutedDeltaDto(
    Guid CropCycleId,
    IReadOnlyList<string> PlannedActivities,
    IReadOnlyList<string> ExecutedActivities,
    IReadOnlyList<string> MissingActivities);

