using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.RecordTestCollected;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class RecordTestCollectedHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);

    private static RecordTestCollectedHandler CreateHandler(
        TestInstance instance,
        TestProtocol? protocol,
        out FakeTestInstanceRepository instanceRepo,
        out FakeAuditOnlyRepository auditRepo)
    {
        instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(instance);
        var protoRepo = new FakeTestProtocolRepository();
        if (protocol is not null) protoRepo.Seed(protocol);
        auditRepo = new FakeAuditOnlyRepository();
        return new RecordTestCollectedHandler(instanceRepo, protoRepo, auditRepo, new FakeClock(Now));
    }

    private static TestInstance NewDueInstance(Guid protocolId)
    {
        return TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: protocolId,
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: Guid.NewGuid(),
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "Flowering",
            plannedDueDate: new DateOnly(2026, 5, 1),
            createdAtUtc: Now);
    }

    [Fact]
    public async Task RecordTestCollected_Worker_Returns_Forbidden()
    {
        var protoId = Guid.NewGuid();
        var instance = NewDueInstance(protoId);
        var handler = CreateHandler(instance, null, out var instanceRepo, out var auditRepo);

        var result = await handler.HandleAsync(new RecordTestCollectedCommand(
            TestInstanceId: instance.Id,
            CallerUserId: UserId.New(),
            CallerRole: AppRole.Worker));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TestRoleNotAllowed");
        instance.Status.Should().Be(TestInstanceStatus.Due);
        auditRepo.AuditEvents.Should().BeEmpty();
        instanceRepo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task RecordTestCollected_LabOperator_Succeeds()
    {
        var proto = TestProtocol.Create(
            Guid.NewGuid(), "Grape soil", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            UserId.New(), Now);
        var instance = NewDueInstance(proto.Id);
        var handler = CreateHandler(instance, proto, out var instanceRepo, out var auditRepo);
        var caller = UserId.New();

        var result = await handler.HandleAsync(new RecordTestCollectedCommand(
            TestInstanceId: instance.Id,
            CallerUserId: caller,
            CallerRole: AppRole.LabOperator));

        result.IsSuccess.Should().BeTrue();
        result.Value.Status.Should().Be("Collected");
        result.Value.TestProtocolName.Should().Be("Grape soil");
        result.Value.CollectedByUserId.Should().Be(caller.Value);
        result.Value.CollectedAtUtc.Should().Be(Now);

        instance.Status.Should().Be(TestInstanceStatus.Collected);
        instanceRepo.SaveCalls.Should().Be(1);

        auditRepo.AuditEvents.Should().HaveCount(1);
        auditRepo.AuditEvents[0].Action.Should().Be("test.collected");
        auditRepo.AuditEvents[0].EntityId.Should().Be(instance.Id);
    }

    [Fact]
    public async Task RecordTestCollected_InstanceNotFound_Returns_TestInstanceNotFound()
    {
        var instanceRepo = new FakeTestInstanceRepository();
        var protoRepo = new FakeTestProtocolRepository();
        var auditRepo = new FakeAuditOnlyRepository();
        var handler = new RecordTestCollectedHandler(instanceRepo, protoRepo, auditRepo, new FakeClock(Now));

        var result = await handler.HandleAsync(new RecordTestCollectedCommand(
            TestInstanceId: Guid.NewGuid(),
            CallerUserId: UserId.New(),
            CallerRole: AppRole.LabOperator));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("ShramSafal.TestInstanceNotFound");
    }
}
