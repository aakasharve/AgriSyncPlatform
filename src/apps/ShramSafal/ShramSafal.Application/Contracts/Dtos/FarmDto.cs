namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FarmDto(
    Guid Id,
    string Name,
    Guid OwnerUserId,
    DateTime CreatedAtUtc);

