namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlannedActivityDto(
    Guid Id,
    Guid CropCycleId,
    string ActivityName,
    string Stage,
    DateOnly PlannedDate,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
