namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed record OverridePlannedActivityCommand(
    Guid PlannedActivityId,
    Guid FarmId,
    DateOnly? NewPlannedDate,
    string? NewActivityName,
    string? NewStage,
    string Reason,
    Guid CallerUserId,
    string? ClientCommandId);
