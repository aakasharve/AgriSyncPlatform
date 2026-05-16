using System.Text.Json;
using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Audit;

/// <summary>
/// Append-only audit ledger entry. Phase 04 (DATA_PRINCIPLE_SPINE_2026-05-05)
/// adds four provenance columns — <see cref="AppVersion"/>, <see cref="DeviceId"/>,
/// <see cref="IpHash"/>, <see cref="SourceAiJobId"/> — and restricts construction
/// to <see cref="AuditEventFactory"/>. Existing static <see cref="Create"/>
/// overloads remain functional (defaulted to sentinel provenance values) until
/// sub-phase 04.3 migrates all 46 handler call sites; the
/// <c>[Obsolete]</c> annotation will be added in that sub-commit so this commit
/// does not detonate the warning-as-error guard at every existing caller.
/// </summary>
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
        string? clientCommandId,
        string appVersion,
        string deviceId,
        string ipHash,
        Guid? sourceAiJobId)
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
        AppVersion = appVersion;
        DeviceId = deviceId;
        IpHash = ipHash;
        SourceAiJobId = sourceAiJobId;
    }

    /// <summary>
    /// Internal ctor used by <see cref="AuditEventFactory.Create"/> — the
    /// only public construction path going forward. Stamps a fresh
    /// <see cref="Guid"/> and <see cref="DateTime.UtcNow"/> on every call.
    /// </summary>
    internal AuditEvent(
        string entityType,
        Guid entityId,
        string action,
        Guid actorUserId,
        string actorRole,
        string payload,
        Guid? farmId,
        string? clientCommandId,
        string appVersion,
        string deviceId,
        string ipHash,
        Guid? sourceAiJobId)
        : this(
            id: Guid.NewGuid(),
            farmId: farmId == Guid.Empty ? null : farmId,
            entityType: entityType,
            entityId: entityId,
            action: action,
            actorUserId: new UserId(actorUserId),
            actorRole: actorRole,
            payload: payload,
            occurredAtUtc: DateTime.UtcNow,
            clientCommandId: string.IsNullOrWhiteSpace(clientCommandId) ? null : clientCommandId.Trim(),
            appVersion: appVersion,
            deviceId: deviceId,
            ipHash: ipHash,
            sourceAiJobId: sourceAiJobId)
    {
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

    // Phase 04.1: provenance columns. Until the EF migration in 04.4 adds the
    // physical columns, these fields are domain-only (EF config does NOT yet
    // map them — that bind lands in 04.4 with the ALTER TABLE). Sentinel
    // defaults on the legacy Create() paths are "unknown" / "sha256:unknown"
    // so existing 46 call sites continue to compile + emit through 04.3
    // migration; the factory path REJECTS empty/whitespace inputs.
    public string AppVersion { get; private set; } = string.Empty;
    public string DeviceId { get; private set; } = string.Empty;
    public string IpHash { get; private set; } = string.Empty;
    public Guid? SourceAiJobId { get; private set; }

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
            actorUserId: new UserId(actorUserId),
            actorRole: normalizedRole,
            payload: serializedPayload,
            occurredAtUtc: occurredAtUtc ?? DateTime.UtcNow,
            clientCommandId: string.IsNullOrWhiteSpace(clientCommandId) ? null : clientCommandId.Trim(),
            // Phase 04.1 sentinels — legacy callers do not yet thread
            // provenance through; sub-phase 04.3 migrates them to
            // AuditEventFactory.Create with real values from the request
            // context (X-Device-Id header + remote IP hash + assembly version).
            appVersion: "unknown",
            deviceId: "unknown",
            ipHash: "sha256:unknown",
            sourceAiJobId: null);
    }
}
