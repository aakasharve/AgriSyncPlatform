using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class MarkOverdueInstancesHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = DateOnly.FromDateTime(Now);

    private static TestInstance ScheduleInstance(Guid protocolId, DateOnly dueDate)
    {
        return TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: protocolId,
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: Guid.NewGuid(),
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "Stage",
            plannedDueDate: dueDate,
            createdAtUtc: Now);
    }

    [Fact]
    public async Task MarkOverdueInstances_MarksOnlyDueWithPastDueDate()
    {
        var protoId = Guid.NewGuid();

        // Past-due + Due → should be marked overdue
        var pastDue1 = ScheduleInstance(protoId, Today.AddDays(-1));
        var pastDue2 = ScheduleInstance(protoId, Today.AddDays(-7));

        // Today → NOT past due (today is not strictly less than today) → not marked
        var today = ScheduleInstance(protoId, Today);

        // Future due → not marked
        var future = ScheduleInstance(protoId, Today.AddDays(3));

        // Past-due but already Collected → should not transition via sweeper
        var collectedPastDue = ScheduleInstance(protoId, Today.AddDays(-2));
        collectedPastDue.MarkCollected(UserId.New(), AppRole.LabOperator, Now);

        var instanceRepo = new FakeTestInstanceRepository();
        instanceRepo.Seed(pastDue1);
        instanceRepo.Seed(pastDue2);
        instanceRepo.Seed(today);
        instanceRepo.Seed(future);
        instanceRepo.Seed(collectedPastDue);

        var auditRepo = new FakeAuditOnlyRepository();
        var clock = new FakeClock(Now);

        var handler = new MarkOverdueInstancesHandler(instanceRepo, auditRepo, clock);

        var count = await handler.HandleAsync(new MarkOverdueInstancesCommand());

        count.Should().Be(2);

        pastDue1.Status.Should().Be(TestInstanceStatus.Overdue);
        pastDue2.Status.Should().Be(TestInstanceStatus.Overdue);
        today.Status.Should().Be(TestInstanceStatus.Due);
        future.Status.Should().Be(TestInstanceStatus.Due);
        collectedPastDue.Status.Should().Be(TestInstanceStatus.Collected);

        // Audit events: one per marked instance
        auditRepo.AuditEvents.Should().HaveCount(2);
        auditRepo.AuditEvents.Should().OnlyContain(e => e.Action == "test.overdue");
        auditRepo.AuditEvents.Should().OnlyContain(e => e.EntityType == "TestInstance");
        auditRepo.AuditEvents.Select(e => e.EntityId).Should()
            .BeEquivalentTo(new[] { pastDue1.Id, pastDue2.Id });

        // Persistence saves
        instanceRepo.SaveCalls.Should().BeGreaterThanOrEqualTo(1);
        auditRepo.SaveCalls.Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public async Task MarkOverdueInstances_ReturnsZero_WhenNothingPastDue()
    {
        var instanceRepo = new FakeTestInstanceRepository();
        var auditRepo = new FakeAuditOnlyRepository();
        var clock = new FakeClock(Now);

        var handler = new MarkOverdueInstancesHandler(instanceRepo, auditRepo, clock);

        var count = await handler.HandleAsync(new MarkOverdueInstancesCommand());

        count.Should().Be(0);
        auditRepo.AuditEvents.Should().BeEmpty();
    }
}
