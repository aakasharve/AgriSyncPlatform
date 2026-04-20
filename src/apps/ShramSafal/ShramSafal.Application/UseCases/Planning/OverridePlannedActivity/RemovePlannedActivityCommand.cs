namespace ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

public sealed record RemovePlannedActivityCommand(
    Guid PlannedActivityId,
    Guid FarmId,
    string Reason,
    Guid CallerUserId,
    string? ClientCommandId);
