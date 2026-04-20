namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed record AddLocalPlannedActivityCommand(
    Guid NewActivityId,
    Guid CropCycleId,
    Guid FarmId,
    string ActivityName,
    string Stage,
    DateOnly PlannedDate,
    string Reason,
    Guid CallerUserId,
    string? ClientCommandId);
