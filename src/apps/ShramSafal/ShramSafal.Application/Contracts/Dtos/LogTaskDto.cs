namespace ShramSafal.Application.Contracts.Dtos;

public sealed record LogTaskDto(
    Guid Id,
    string ActivityType,
    string? Notes,
    DateTime OccurredAtUtc);

