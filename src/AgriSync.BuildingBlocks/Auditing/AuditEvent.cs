namespace AgriSync.BuildingBlocks.Auditing;

public sealed record AuditEvent(
    Guid EventId,
    string ActorId,
    string Action,
    string TargetType,
    string TargetId,
    DateTime OccurredOnUtc,
    string? CorrelationId,
    string? MetadataJson);
