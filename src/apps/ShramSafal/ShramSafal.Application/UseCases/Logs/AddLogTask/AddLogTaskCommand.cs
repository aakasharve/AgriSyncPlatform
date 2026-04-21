using ShramSafal.Domain.Logs;

namespace ShramSafal.Application.UseCases.Logs.AddLogTask;

public sealed record AddLogTaskCommand(
    Guid DailyLogId,
    string ActivityType,
    string? Notes,
    DateTime? OccurredAtUtc = null,
    Guid? LogTaskId = null,
    Guid ActorUserId = default,
    string? ActorRole = null,
    string? ClientCommandId = null,
    ExecutionStatus ExecutionStatus = ExecutionStatus.Completed,
    string? DeviationReasonCode = null,
    string? DeviationNote = null);
