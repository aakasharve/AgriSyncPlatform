using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.GetMissingTestsForFarm;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class GetMissingTestsForFarmHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = DateOnly.FromDateTime(Now);

    private static TestInstance ScheduleInstance(
        FarmId farmId, Guid protocolId, string stageName, DateOnly dueDate)
    {
        return TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: protocolId,
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: Guid.NewGuid(),
            farmId: farmId,
            plotId: Guid.NewGuid(),
            stageName: stageName,
            plannedDueDate: dueDate,
            createdAtUtc: Now);
    }

    [Fact]
    public async Task GetMissingTestsForFarm_ReturnsOnlyDueAndOverdue()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var otherFarmId = new FarmId(Guid.NewGuid());
        var protoId = Guid.NewGuid();

        var protocol = TestProtocol.Create(
            protoId, "Grape soil", "Grapes",
            TestProtocolKind.Soil, TestProtocolPeriodicity.OneTime,
            UserId.New(), Now);

        // Eligible (Due, past date)
        var dueOverduePast = ScheduleInstance(farmId, protoId, "Stage1", Today.AddDays(-3));
        // Eligible (Due, today)
        var dueToday = ScheduleInstance(farmId, protoId, "Stage2", Today);
        // Not eligible — future date
        var dueFuture = ScheduleInstance(farmId, protoId, "Stage3", Today.AddDays(3));
        // Not eligible — Collected
        var collected = ScheduleInstance(farmId, protoId, "Stage4", Today.AddDays(-1));
        collected.MarkCollected(UserId.New(), AppRole.LabOperator, Now);
        // Eligible (Overdue, past date)
        var overdue = ScheduleInstance(farmId, protoId, "Stage5", Today.AddDays(-10));
        overdue.MarkOverdue(Now);
        // Different farm — not included
        var otherFarmInstance = ScheduleInstance(otherFarmId, protoId, "X", Today.AddDays(-5));

        var instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(dueOverduePast);
        instanceRepo.Seed(dueToday);
        instanceRepo.Seed(dueFuture);
        instanceRepo.Seed(collected);
        instanceRepo.Seed(overdue);
        instanceRepo.Seed(otherFarmInstance);

        var protoRepo = new FakeTestProtocolRepository();
        protoRepo.Seed(protocol);

        var handler = new GetMissingTestsForFarmHandler(instanceRepo, protoRepo, new FakeClock(Now));

        var result = await handler.HandleAsync(new GetMissingTestsForFarmQuery(farmId));

        result.Should().HaveCount(3);
        result.Select(r => r.TestInstanceId).Should().BeEquivalentTo(new[]
        {
            overdue.Id, dueOverduePast.Id, dueToday.Id
        });

        // All should have protocol name populated
        result.Should().OnlyContain(r => r.TestProtocolName == "Grape soil");

        // Days overdue check
        result.Single(r => r.TestInstanceId == dueToday.Id).DaysOverdue.Should().Be(0);
        result.Single(r => r.TestInstanceId == dueOverduePast.Id).DaysOverdue.Should().Be(3);
        result.Single(r => r.TestInstanceId == overdue.Id).DaysOverdue.Should().Be(10);

        // Order ascending by planned due date
        result.Select(r => r.PlannedDueDate).Should().BeInAscendingOrder();
    }
}
