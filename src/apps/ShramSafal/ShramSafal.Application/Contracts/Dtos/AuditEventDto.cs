namespace ShramSafal.Application.Contracts.Dtos;

public sealed record AuditEventDto(
    Guid Id,
    Guid? FarmId,
    string EntityType,
    Guid EntityId,
    string Action,
    Guid ActorUserId,
    string ActorRole,
    string Payload,
    DateTime OccurredAtUtc,
    string? ClientCommandId);
