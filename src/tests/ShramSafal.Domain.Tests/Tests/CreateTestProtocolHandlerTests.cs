using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.CreateTestProtocol;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class CreateTestProtocolHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);

    private static CreateTestProtocolHandler CreateHandler(
        out FakeTestProtocolRepository protoRepo,
        out FakeAuditOnlyRepository auditRepo)
    {
        protoRepo = new FakeTestProtocolRepository();
        auditRepo = new FakeAuditOnlyRepository();
        var clock = new FakeClock(Now);
        var ids = new FakeIdGenerator();
        return new CreateTestProtocolHandler(protoRepo, auditRepo, ids, clock);
    }

    [Fact]
    public async Task CreateTestProtocol_Worker_Returns_Forbidden()
    {
        var handler = CreateHandler(out var protoRepo, out var auditRepo);

        var result = await handler.HandleAsync(new CreateTestProtocolCommand(
            Name: "Grape soil — pre-flowering",
            CropType: "Grapes",
            Kind: TestProtocolKind.Soil,
            Periodicity: TestProtocolPeriodicity.OneTime,
            EveryNDays: null,
            StageNames: new[] { "PreFlowering" },
            ParameterCodes: new[] { "pH", "N" },
            CallerUserId: UserId.New(),
            CallerRole: AppRole.Worker));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TestRoleNotAllowed");
        protoRepo.Added.Should().BeEmpty();
        auditRepo.AuditEvents.Should().BeEmpty();
        auditRepo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task CreateTestProtocol_Agronomist_Succeeds_AndEmitsAudit()
    {
        var handler = CreateHandler(out var protoRepo, out var auditRepo);

        var caller = UserId.New();

        var result = await handler.HandleAsync(new CreateTestProtocolCommand(
            Name: "Grape petiole — veraison",
            CropType: "Grapes",
            Kind: TestProtocolKind.Petiole,
            Periodicity: TestProtocolPeriodicity.PerStage,
            EveryNDays: null,
            StageNames: new[] { "Veraison", "Flowering" },
            ParameterCodes: new[] { "K", "N" },
            CallerUserId: caller,
            CallerRole: AppRole.Agronomist));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBe(Guid.Empty);

        protoRepo.Added.Should().HaveCount(1);
        var protocol = protoRepo.Added[0];
        protocol.Id.Should().Be(result.Value);
        protocol.Name.Should().Be("Grape petiole — veraison");
        protocol.CropType.Should().Be("Grapes");
        protocol.Kind.Should().Be(TestProtocolKind.Petiole);
        protocol.Periodicity.Should().Be(TestProtocolPeriodicity.PerStage);
        protocol.StageNames.Should().BeEquivalentTo(new[] { "Veraison", "Flowering" });
        protocol.ParameterCodes.Should().BeEquivalentTo(new[] { "K", "N" });

        auditRepo.AuditEvents.Should().HaveCount(1);
        var audit = auditRepo.AuditEvents[0];
        audit.Action.Should().Be("test.protocol.created");
        audit.EntityType.Should().Be("TestProtocol");
        audit.EntityId.Should().Be(protocol.Id);
        audit.ActorUserId.Should().Be(caller);
        audit.ActorRole.Should().Be("agronomist");

        auditRepo.SaveCalls.Should().Be(1);
    }
}
