namespace ShramSafal.Application.Contracts.Dtos;

public sealed record LogTaskDto(
    Guid Id,
    string ActivityType,
    string? Notes,
    DateTime OccurredAtUtc,
    string ExecutionStatus,       // "Completed", "Partial", etc.
    string? DeviationReasonCode,
    string? DeviationNote);

