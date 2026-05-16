// spec: data-principle-spine-2026-05-05/04.1
// Phase 04 sub-phase 04.1 — sole public construction surface for AuditEvent.
// Forces every audit emission to carry provenance (app version + device id +
// hashed IP), and optionally a source AI job correlation id. Existing static
// AuditEvent.Create methods stay functional through 04.3 (handler migration);
// the [Obsolete] annotation lands in the 04.3 commit so this commit doesn't
// detonate the warning-as-error guard at all 46 callers.

using System.Text.Json;

namespace ShramSafal.Domain.Audit;

/// <summary>
/// Sole supported construction path for <see cref="AuditEvent"/> going forward.
/// Validates every required field up-front so an audit row cannot be persisted
/// with empty provenance — the architecture test added in sub-phase 04.5
/// will forbid direct <c>new AuditEvent(...)</c> outside this assembly.
/// </summary>
public static class AuditEventFactory
{
    private static readonly JsonSerializerOptions PayloadSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    /// <summary>
    /// Convenience overload that accepts <paramref name="payload"/> as an
    /// anonymous object (the dominant 04.3 handler call-site shape) and
    /// JSON-serializes it with the same camelCase policy the legacy
    /// <c>AuditEvent.Create(...)</c> methods used. Forwards to the
    /// string-payload overload after serialization; all provenance
    /// validation rules are identical.
    /// </summary>
    public static AuditEvent Create(
        string entityType,
        Guid entityId,
        string action,
        Guid actorUserId,
        string actorRole,
        object payload,
        Guid? farmId,
        string? clientCommandId,
        string appVersion,
        string deviceId,
        string ipHash,
        Guid? sourceAiJobId = null)
    {
        var serialized = JsonSerializer.Serialize(payload, PayloadSerializerOptions);
        return Create(
            entityType: entityType,
            entityId: entityId,
            action: action,
            actorUserId: actorUserId,
            actorRole: actorRole,
            payload: serialized,
            farmId: farmId,
            clientCommandId: clientCommandId,
            appVersion: appVersion,
            deviceId: deviceId,
            ipHash: ipHash,
            sourceAiJobId: sourceAiJobId);
    }

    /// <summary>
    /// Build a new <see cref="AuditEvent"/> with full provenance stamped from
    /// the calling request context. <paramref name="appVersion"/> /
    /// <paramref name="deviceId"/> / <paramref name="ipHash"/> are mandatory;
    /// pass <c>null</c> for <paramref name="sourceAiJobId"/> on non-AI flows.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// Thrown when any required field is empty / whitespace / <see cref="Guid.Empty"/>.
    /// The message embeds the field's snake_case name so factory tests can
    /// assert on the wildcard (e.g. <c>*app_version*</c>) without coupling
    /// to the parameter binding.
    /// </exception>
    public static AuditEvent Create(
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
        Guid? sourceAiJobId = null)
    {
        if (string.IsNullOrWhiteSpace(entityType))
        {
            throw new ArgumentException("entity_type required", nameof(entityType));
        }

        if (entityId == Guid.Empty)
        {
            throw new ArgumentException("entity_id required", nameof(entityId));
        }

        if (string.IsNullOrWhiteSpace(action))
        {
            throw new ArgumentException("action required", nameof(action));
        }

        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("actor_user_id required", nameof(actorUserId));
        }

        if (string.IsNullOrWhiteSpace(actorRole))
        {
            throw new ArgumentException("actor_role required", nameof(actorRole));
        }

        if (string.IsNullOrWhiteSpace(appVersion))
        {
            throw new ArgumentException("app_version required", nameof(appVersion));
        }

        if (string.IsNullOrWhiteSpace(deviceId))
        {
            throw new ArgumentException("device_id required", nameof(deviceId));
        }

        if (string.IsNullOrWhiteSpace(ipHash))
        {
            throw new ArgumentException("ip_hash required", nameof(ipHash));
        }

        return new AuditEvent(
            entityType: entityType.Trim(),
            entityId: entityId,
            action: action.Trim(),
            actorUserId: actorUserId,
            actorRole: actorRole.Trim(),
            payload: payload,
            farmId: farmId,
            clientCommandId: clientCommandId,
            appVersion: appVersion.Trim(),
            deviceId: deviceId.Trim(),
            ipHash: ipHash.Trim(),
            sourceAiJobId: sourceAiJobId);
    }
}
