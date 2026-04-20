using System;
using System.Linq;
using System.Reflection;
using ShramSafal.Domain.Audit;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

public sealed class AuditEventTests
{
    [Fact]
    public void Create_SetsAllFields()
    {
        var farmId = Guid.NewGuid();
        var entityId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();
        var occurredAtUtc = DateTime.UtcNow;

        var auditEvent = AuditEvent.Create(
            farmId,
            "DailyLog",
            entityId,
            "Created",
            actorUserId,
            "PrimaryOwner",
            new { taskCount = 2 },
            "cmd-123",
            occurredAtUtc);

        Assert.Equal(farmId, auditEvent.FarmId);
        Assert.Equal("DailyLog", auditEvent.EntityType);
        Assert.Equal(entityId, auditEvent.EntityId);
        Assert.Equal("Created", auditEvent.Action);
        Assert.Equal(actorUserId, (Guid)auditEvent.ActorUserId);
        Assert.Equal("PrimaryOwner", auditEvent.ActorRole);
        Assert.Equal("cmd-123", auditEvent.ClientCommandId);
        Assert.Equal(occurredAtUtc, auditEvent.OccurredAtUtc);
    }

    [Fact]
    public void Create_SerializesPayloadJson()
    {
        var auditEvent = AuditEvent.Create(
            "CostEntry",
            Guid.NewGuid(),
            "Corrected",
            Guid.NewGuid(),
            "PrimaryOwner",
            new { reason = "duplicate", correctedAmount = 1200m });

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
