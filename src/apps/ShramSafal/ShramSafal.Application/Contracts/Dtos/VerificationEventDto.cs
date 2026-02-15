namespace ShramSafal.Application.Contracts.Dtos;

public sealed record VerificationEventDto(
    Guid Id,
    string Status,
    string? Reason,
    Guid VerifiedByUserId,
    DateTime OccurredAtUtc);

