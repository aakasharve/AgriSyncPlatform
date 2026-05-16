using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Audit;

/// <summary>
/// Append-only audit ledger entry. Phase 04 (DATA_PRINCIPLE_SPINE_2026-05-05)
/// adds four provenance columns — <see cref="AppVersion"/>, <see cref="DeviceId"/>,
/// <see cref="IpHash"/>, <see cref="SourceAiJobId"/> — and restricts construction
/// to <see cref="AuditEventFactory"/>.
/// <para>
/// Sub-commit D (sub-phase 04.3b §Part 5) DELETED the legacy
/// <c>public static AuditEvent Create(...)</c> overloads. Every prior caller
/// now routes through <see cref="AuditEventFactory.Create"/> which validates
/// the forensic-provenance trio (<c>app_version</c> / <c>device_id</c> /
/// <c>ip_hash</c>) up-front. Architectural lock:
/// <see cref="AgriSync.ArchitectureTests.AuditConstructionRules"/>.
/// </para>
/// </summary>
public sealed class AuditEvent : Entity<Guid>
{
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
    /// only supported construction path. Stamps a fresh <see cref="Guid"/>
    /// and <see cref="DateTime.UtcNow"/> on every call.
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
    // map them — that bind lands in 04.4 with the ALTER TABLE). The factory
    // path REJECTS empty/whitespace inputs for app_version, device_id, and
    // ip_hash so an audit row cannot be persisted without identifiable
    // provenance.
    public string AppVersion { get; private set; } = string.Empty;
    public string DeviceId { get; private set; } = string.Empty;
    public string IpHash { get; private set; } = string.Empty;
    public Guid? SourceAiJobId { get; private set; }
}
