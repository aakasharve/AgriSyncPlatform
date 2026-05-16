// spec: data-principle-spine-2026-05-05/04.1
// Failing-test-first authored per plan §04.1.1. Asserts AuditEventFactory.Create:
//   (a) rejects empty/whitespace required fields with messages embedding the
//       snake_case field name so wildcard expectations stay stable;
//   (b) stamps OccurredAtUtc to server time, not caller-supplied;
//   (c) preserves every provenance field on the resulting AuditEvent.

using System;
using FluentAssertions;
using ShramSafal.Domain.Audit;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

public sealed class AuditEventFactoryTests
{
    private static AuditEvent Build(
        string entityType = "DailyLog",
        Guid? entityId = null,
        string action = "Created",
        Guid? actorUserId = null,
        string actorRole = "operator",
        string payload = "{}",
        Guid? farmId = null,
        string? clientCommandId = "cmd-1",
        string appVersion = "1.0.0",
        string deviceId = "device-1",
        string ipHash = "sha256:abc",
        Guid? sourceAiJobId = null) =>
        AuditEventFactory.Create(
            entityType: entityType,
            entityId: entityId ?? Guid.NewGuid(),
            action: action,
            actorUserId: actorUserId ?? Guid.NewGuid(),
            actorRole: actorRole,
            payload: payload,
            farmId: farmId,
            clientCommandId: clientCommandId,
            appVersion: appVersion,
            deviceId: deviceId,
            ipHash: ipHash,
            sourceAiJobId: sourceAiJobId);

    [Fact]
    public void Create_requires_app_version_device_and_ip_hash()
    {
        // empty appVersion
        var actAppVersion = () => Build(appVersion: "");
        actAppVersion.Should().Throw<ArgumentException>().WithMessage("*app_version*");

        // whitespace appVersion
        var actAppVersionWs = () => Build(appVersion: "   ");
        actAppVersionWs.Should().Throw<ArgumentException>().WithMessage("*app_version*");

        // empty deviceId
        var actDevice = () => Build(deviceId: "");
        actDevice.Should().Throw<ArgumentException>().WithMessage("*device_id*");

        // empty ipHash
        var actIp = () => Build(ipHash: "");
        actIp.Should().Throw<ArgumentException>().WithMessage("*ip_hash*");
    }

    [Fact]
    public void Create_requires_entity_type_action_and_actor_user_id()
    {
        var actEntityType = () => Build(entityType: "");
        actEntityType.Should().Throw<ArgumentException>().WithMessage("*entity_type*");

        var actEntityId = () => Build(entityId: Guid.Empty);
        actEntityId.Should().Throw<ArgumentException>().WithMessage("*entity_id*");

        var actAction = () => Build(action: "  ");
        actAction.Should().Throw<ArgumentException>().WithMessage("*action*");

        var actActor = () => Build(actorUserId: Guid.Empty);
        actActor.Should().Throw<ArgumentException>().WithMessage("*actor_user_id*");

        var actRole = () => Build(actorRole: "");
        actRole.Should().Throw<ArgumentException>().WithMessage("*actor_role*");
    }

    [Fact]
    public void Create_stamps_occurredAtUtc_to_server_time()
    {
        var before = DateTime.UtcNow;
        var e = Build();
        var after = DateTime.UtcNow;

        e.OccurredAtUtc.Should().BeOnOrAfter(before).And.BeOnOrBefore(after);
    }

    [Fact]
    public void Create_sets_all_provenance_fields_from_input()
    {
        var entityId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var farmId = Guid.NewGuid();
        var aiJobId = Guid.NewGuid();

        var e = Build(
            entityType: "DailyLog",
            entityId: entityId,
            action: "Created",
            actorUserId: actorId,
            actorRole: "PrimaryOwner",
            payload: "{\"k\":1}",
            farmId: farmId,
            clientCommandId: "cmd-42",
            appVersion: "2.5.1",
            deviceId: "device-abc",
            ipHash: "sha256:deadbeef",
            sourceAiJobId: aiJobId);

        e.EntityType.Should().Be("DailyLog");
        e.EntityId.Should().Be(entityId);
        e.Action.Should().Be("Created");
        ((Guid)e.ActorUserId).Should().Be(actorId);
        e.ActorRole.Should().Be("PrimaryOwner");
        e.Payload.Should().Be("{\"k\":1}");
        e.FarmId.Should().Be(farmId);
        e.ClientCommandId.Should().Be("cmd-42");
        e.AppVersion.Should().Be("2.5.1");
        e.DeviceId.Should().Be("device-abc");
        e.IpHash.Should().Be("sha256:deadbeef");
        e.SourceAiJobId.Should().Be(aiJobId);
    }

    [Fact]
    public void Create_normalizes_empty_farm_id_to_null()
    {
        // The internal ctor maps Guid.Empty → null so the EF column stays NULL
        // when no farm context is available (mirrors the legacy Create path).
        var e = Build(farmId: Guid.Empty);
        e.FarmId.Should().BeNull();
    }

    [Fact]
    public void Create_allows_null_sourceAiJobId_for_non_ai_flows()
    {
        var e = Build(sourceAiJobId: null);
        e.SourceAiJobId.Should().BeNull();
    }

    [Fact]
    public void Create_trims_whitespace_on_string_inputs()
    {
        var e = Build(
            entityType: "  DailyLog  ",
            action: "  Created  ",
            actorRole: "  operator  ",
            appVersion: "  1.0.0  ",
            deviceId: "  device-1  ",
            ipHash: "  sha256:abc  ");

        e.EntityType.Should().Be("DailyLog");
        e.Action.Should().Be("Created");
        e.ActorRole.Should().Be("operator");
        e.AppVersion.Should().Be("1.0.0");
        e.DeviceId.Should().Be("device-1");
        e.IpHash.Should().Be("sha256:abc");
    }
}
