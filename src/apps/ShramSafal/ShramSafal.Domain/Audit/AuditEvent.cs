using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Audit;

public sealed class AuditEvent : Entity<Guid>
{
    private static readonly JsonSerializerOptions PayloadSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private AuditEvent() : base(Guid.Empty) { } // EF Core

    private AuditEvent(
        Guid id,
        Guid? farmId,
        string entityType,
        Guid entityId,
        string action,
        UserId actorUserId,
        string actorRole,
        string payload,
        DateTime occurredAtUtc,
        string? clientCommandId)
        : base(id)
    {
        FarmId = farmId;
        EntityType = entityType;
        EntityId = entityId;
        Action = action;
        ActorUserId = actorUserId;
        ActorRole = actorRole;
        Payload = payload;
        OccurredAtUtc = occurredAtUtc;
        ClientCommandId = clientCommandId;
    }

    public Guid? FarmId { get; private set; }
    public string EntityType { get; private set; } = string.Empty;
    public Guid EntityId { get; private set; }
    public string Action { get; private set; } = string.Empty;
    public UserId ActorUserId { get; private set; }
    public string ActorRole { get; private set; } = string.Empty;
    public string Payload { get; private set; } = "{}";
    public DateTime OccurredAtUtc { get; private set; }
    public string? ClientCommandId { get; private set; }

    public static AuditEvent Create(
        string entityType,
        Guid entityId,
        string action,
        Guid actorUserId,
        string actorRole,
        object payload,
        string? clientCommandId = null,
        DateTime? occurredAtUtc = null) =>
        Create(
            farmId: null,
            entityType,
            entityId,
            action,
            actorUserId,
            actorRole,
            payload,
            clientCommandId,
            occurredAtUtc);

    public static AuditEvent Create(
        Guid? farmId,
        string entityType,
        Guid entityId,
        string action,
        Guid actorUserId,
        string actorRole,
        object payload,
        string? clientCommandId = null,
        DateTime? occurredAtUtc = null)
    {
        if (string.IsNullOrWhiteSpace(entityType))
        {
            throw new ArgumentException("Entity type is required.", nameof(entityType));
        }

        if (entityId == Guid.Empty)
        {
            throw new ArgumentException("Entity id is required.", nameof(entityId));
        }

        if (string.IsNullOrWhiteSpace(action))
        {
            throw new ArgumentException("Action is required.", nameof(action));
        }

        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("Actor user id is required.", nameof(actorUserId));
        }

        var normalizedRole = string.IsNullOrWhiteSpace(actorRole)
            ? "unknown"
            : actorRole.Trim();

        var serializedPayload = JsonSerializer.Serialize(payload, PayloadSerializerOptions);

        return new AuditEvent(
            id: Guid.NewGuid(),
            farmId: farmId == Guid.Empty ? null : farmId,
            entityType: entityType.Trim(),
            entityId,
            action: action.Trim(),
            actorUserId,
            normalizedRole,
            serializedPayload,
            occurredAtUtc ?? DateTime.UtcNow,
            string.IsNullOrWhiteSpace(clientCommandId) ? null : clientCommandId.Trim());
    }
}
