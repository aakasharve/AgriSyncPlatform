namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

public sealed record AddLogTaskCommand(
    Guid DailyLogId,
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null,
    Guid? LogTaskId = null);
