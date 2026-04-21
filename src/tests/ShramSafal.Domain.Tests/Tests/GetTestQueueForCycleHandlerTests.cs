using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.GetTestQueueForCycle;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class GetTestQueueForCycleHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);

    private static TestInstance ScheduleInstance(
        Guid cropCycleId, Guid protocolId, DateOnly dueDate)
    {
        return TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: protocolId,
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: cropCycleId,
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "Stage",
            plannedDueDate: dueDate,
            createdAtUtc: Now);
    }

    [Fact]
    public async Task GetTestQueueForCycle_OrdersByPlannedDueDate()
    {
        var cycleId = Guid.NewGuid();
        var protoId = Guid.NewGuid();

        var proto = TestProtocol.Create(
            protoId, "Grape soil", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            UserId.New(), Now);

        var i1 = ScheduleInstance(cycleId, protoId, new DateOnly(2026, 5, 15));
        var i2 = ScheduleInstance(cycleId, protoId, new DateOnly(2026, 5, 1));
        var i3 = ScheduleInstance(cycleId, protoId, new DateOnly(2026, 6, 1));

        var instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(i1);
        instanceRepo.Seed(i2);
        instanceRepo.Seed(i3);

        var protoRepo = new FakeTestProtocolRepository();
        protoRepo.Seed(proto);

        var handler = new GetTestQueueForCycleHandler(instanceRepo, protoRepo);

        var result = await handler.HandleAsync(new GetTestQueueForCycleQuery(cycleId));

        result.Should().HaveCount(3);
        result.Select(r => r.TestInstanceId).Should().ContainInOrder(i2.Id, i1.Id, i3.Id);
        result.Should().OnlyContain(r => r.TestProtocolName == "Grape soil");
        result.Should().OnlyContain(r => r.Status == "Due");
    }

    [Fact]
    public async Task GetTestQueueForCycle_ExcludesReported_ByDefault()
    {
        var cycleId = Guid.NewGuid();
        var protoId = Guid.NewGuid();

        var proto = TestProtocol.Create(
            protoId, "Grape soil", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            UserId.New(), Now);

        var due = ScheduleInstance(cycleId, protoId, new DateOnly(2026, 6, 1));
        var reported = ScheduleInstance(cycleId, protoId, new DateOnly(2026, 5, 1));
        reported.MarkCollected(UserId.New(), AppRole.LabOperator, Now);
        reported.RecordResult(
            UserId.New(), AppRole.LabOperator,
            new[] { new TestResult("pH", "6.5", "pH", 6.0m, 7.5m) },
            new[] { Guid.NewGuid() }, Now);

        var instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(due);
        instanceRepo.Seed(reported);

        var protoRepo = new FakeTestProtocolRepository();
        protoRepo.Seed(proto);

        var handler = new GetTestQueueForCycleHandler(instanceRepo, protoRepo);

        var defaultResult = await handler.HandleAsync(new GetTestQueueForCycleQuery(cycleId));
        defaultResult.Should().HaveCount(1);
        defaultResult[0].TestInstanceId.Should().Be(due.Id);

        var allResult = await handler.HandleAsync(new GetTestQueueForCycleQuery(cycleId, IncludeReported: true));
        allResult.Should().HaveCount(2);
    }
}
