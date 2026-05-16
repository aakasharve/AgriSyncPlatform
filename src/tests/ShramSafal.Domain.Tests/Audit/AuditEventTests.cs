using System;
using System.Linq;
using System.Reflection;
using ShramSafal.Domain.Audit;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// AuditEvent shape tests. Asserts the per-row immutability + append-only
/// surface contract.
/// <para>
/// Construction-path validation (mandatory provenance, trimming, server
/// timestamp stamping, etc.) lives in
/// <see cref="AuditEventFactoryTests"/>. The legacy
/// <c>AuditEvent.Create(...)</c> static overloads were deleted in
/// DATA_PRINCIPLE_SPINE sub-phase 04.3b Sub-commit D — every test that
/// needs an <see cref="AuditEvent"/> instance now builds one via
/// <see cref="AuditEventFactory.Create"/>.
/// </para>
/// </summary>
public sealed class AuditEventTests
{
    [Fact]
    public void Factory_SetsAllFields()
    {
        var farmId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();

        var auditEvent = AuditEventFactory.Create(
            entityType: "DailyLog",
            entityId: entityId,
            action: "Created",
            actorUserId: actorUserId,
            actorRole: "PrimaryOwner",
            payload: new { taskCount = 2 },
            farmId: farmId,
            clientCommandId: "cmd-123",
            appVersion: "1.0.0",
            deviceId: "device-1",
            ipHash: "sha256:abc",
            sourceAiJobId: null);

        Assert.Equal(farmId, auditEvent.FarmId);
        Assert.Equal("DailyLog", auditEvent.EntityType);
        Assert.Equal(entityId, auditEvent.EntityId);
        Assert.Equal("Created", auditEvent.Action);
        Assert.Equal(actorUserId, (Guid)auditEvent.ActorUserId);
        Assert.Equal("PrimaryOwner", auditEvent.ActorRole);
        Assert.Equal("cmd-123", auditEvent.ClientCommandId);
        // OccurredAtUtc is stamped to server time by the factory; just
        // verify it landed somewhere in the recent past — AuditEventFactoryTests
        // covers the before/after bracket.
        Assert.InRange(auditEvent.OccurredAtUtc, DateTime.UtcNow.AddMinutes(-1), DateTime.UtcNow.AddSeconds(1));
    }

    [Fact]
    public void Factory_SerializesPayloadJson()
    {
        var auditEvent = AuditEventFactory.Create(
            entityType: "CostEntry",
            entityId: Guid.NewGuid(),
            action: "Corrected",
            actorUserId: Guid.NewGuid(),
            actorRole: "PrimaryOwner",
            payload: new { reason = "duplicate", correctedAmount = 1200m },
            farmId: null,
            clientCommandId: null,
            appVersion: "1.0.0",
            deviceId: "device-1",
            ipHash: "sha256:abc",
            sourceAiJobId: null);

        Assert.Contains("\"reason\":\"duplicate\"", auditEvent.Payload);
        Assert.Contains("\"correctedAmount\":1200", auditEvent.Payload);
    }

    [Fact]
    public void AuditEvent_IsAppendOnlyShape()
    {
        var settableProperties = typeof(AuditEvent)
            .GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .Where(x => x.SetMethod is { IsPublic: true })
            .ToList();

        Assert.Empty(settableProperties);

        var declaredMethods = typeof(AuditEvent)
            .GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly)
            .Select(x => x.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.DoesNotContain("Update", declaredMethods);
        Assert.DoesNotContain("Delete", declaredMethods);
    }
}
