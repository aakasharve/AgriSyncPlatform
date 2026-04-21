using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class TestInstanceTests
{
    private static TestInstance NewDueInstance()
    {
        return TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: Guid.NewGuid(),
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: Guid.NewGuid(),
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "Flowering",
            plannedDueDate: new DateOnly(2026, 5, 1),
            createdAtUtc: DateTime.UtcNow);
    }

    [Fact]
    public void TestInstance_Schedule_StartsInDue()
    {
        var instance = NewDueInstance();

        instance.Status.Should().Be(TestInstanceStatus.Due);
        instance.CollectedAtUtc.Should().BeNull();
        instance.ReportedAtUtc.Should().BeNull();
        instance.AttachmentIds.Should().BeEmpty();
        instance.Results.Should().BeEmpty();
        instance.DomainEvents.OfType<TestInstanceScheduledEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void TestInstance_MarkCollected_ByWorker_Throws_RoleDenied()
    {
        var instance = NewDueInstance();

        FluentActions.Invoking(() => instance.MarkCollected(
                UserId.New(), AppRole.Worker, DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();

        instance.Status.Should().Be(TestInstanceStatus.Due);
    }

    [Fact]
    public void TestInstance_MarkCollected_ByMukadam_TransitionsToCollected()
    {
        var instance = NewDueInstance();
        var collector = UserId.New();

        instance.MarkCollected(collector, AppRole.Mukadam, DateTime.UtcNow);

        instance.Status.Should().Be(TestInstanceStatus.Collected);
        instance.CollectedByUserId.Should().Be(collector);
        instance.DomainEvents.OfType<TestInstanceCollectedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void TestInstance_RecordResult_WithZeroAttachments_Throws_CEI_I5()
    {
        var instance = NewDueInstance();
        instance.MarkCollected(UserId.New(), AppRole.LabOperator, DateTime.UtcNow);

        var results = new[]
        {
            new TestResult("pH", "6.5", "pH", 6.0m, 7.5m)
        };

        FluentActions.Invoking(() => instance.RecordResult(
                UserId.New(),
                AppRole.LabOperator,
                results,
                attachmentIds: Array.Empty<Guid>(),
                DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>()
            .WithMessage("*CEI-I5*");

        instance.Status.Should().Be(TestInstanceStatus.Collected);  // unchanged
    }

    [Fact]
    public void TestInstance_RecordResult_WithAttachments_TransitionsToReported()
    {
        var instance = NewDueInstance();
        instance.MarkCollected(UserId.New(), AppRole.LabOperator, DateTime.UtcNow);

        var reporter = UserId.New();
        var attachments = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var results = new[]
        {
            new TestResult("pH", "6.5", "pH", 6.0m, 7.5m),
            new TestResult("N", "300", "ppm", 250m, null)
        };

        instance.RecordResult(reporter, AppRole.LabOperator, results, attachments, DateTime.UtcNow);

        instance.Status.Should().Be(TestInstanceStatus.Reported);
        instance.ReportedByUserId.Should().Be(reporter);
        instance.AttachmentIds.Should().HaveCount(2);
        instance.Results.Should().HaveCount(2);

        var reported = instance.DomainEvents.OfType<TestInstanceReportedEvent>().Single();
        reported.ResultCount.Should().Be(2);
        reported.AttachmentCount.Should().Be(2);
    }

    [Fact]
    public void TestInstance_RecordResult_NonLabOperator_Throws()
    {
        var instance = NewDueInstance();
        instance.MarkCollected(UserId.New(), AppRole.Mukadam, DateTime.UtcNow);

        FluentActions.Invoking(() => instance.RecordResult(
                UserId.New(),
                AppRole.SecondaryOwner,  // not LabOperator
                new[] { new TestResult("pH", "6.5", "pH", 6.0m, 7.5m) },
                new[] { Guid.NewGuid() },
                DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void TestInstance_RecordResult_FromDueWithoutCollection_Throws()
    {
        var instance = NewDueInstance();  // still Due

        FluentActions.Invoking(() => instance.RecordResult(
                UserId.New(),
                AppRole.LabOperator,
                new[] { new TestResult("pH", "6.5", "pH", 6.0m, 7.5m) },
                new[] { Guid.NewGuid() },
                DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void TestInstance_MarkOverdue_FromDue_TransitionsToOverdue()
    {
        var instance = NewDueInstance();
        instance.MarkOverdue(DateTime.UtcNow);
        instance.Status.Should().Be(TestInstanceStatus.Overdue);
    }

    [Fact]
    public void TestInstance_MarkOverdue_FromCollected_IsIdempotentNoop()
    {
        var instance = NewDueInstance();
        instance.MarkCollected(UserId.New(), AppRole.Mukadam, DateTime.UtcNow);

        instance.MarkOverdue(DateTime.UtcNow);  // should not change Collected state

        instance.Status.Should().Be(TestInstanceStatus.Collected);
    }

    [Fact]
    public void TestInstance_Waive_Worker_Throws_Agronomist_OK_PrimaryOwner_OK_ReasonRequired()
    {
        // Worker cannot waive
        var inst1 = NewDueInstance();
        FluentActions.Invoking(() => inst1.Waive(
                UserId.New(), AppRole.Worker, "too wet", DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();
        inst1.Status.Should().Be(TestInstanceStatus.Due);

        // Agronomist OK
        var inst2 = NewDueInstance();
        inst2.Waive(UserId.New(), AppRole.Agronomist, "not applicable this season", DateTime.UtcNow);
        inst2.Status.Should().Be(TestInstanceStatus.Waived);
        inst2.WaivedReason.Should().Be("not applicable this season");

        // PrimaryOwner OK
        var inst3 = NewDueInstance();
        inst3.Waive(UserId.New(), AppRole.PrimaryOwner, "owner decision", DateTime.UtcNow);
        inst3.Status.Should().Be(TestInstanceStatus.Waived);

        // Reason required
        var inst4 = NewDueInstance();
        FluentActions.Invoking(() => inst4.Waive(
                UserId.New(), AppRole.Agronomist, "  ", DateTime.UtcNow))
            .Should().Throw<ArgumentException>();
    }

    [Fact]
    public void TestInstance_Waive_FromOverdue_Succeeds()
    {
        var instance = NewDueInstance();
        instance.MarkOverdue(DateTime.UtcNow);

        instance.Waive(UserId.New(), AppRole.Agronomist, "skip this cycle", DateTime.UtcNow);

        instance.Status.Should().Be(TestInstanceStatus.Waived);
    }

    [Fact]
    public void TestInstance_MarkCollected_FromCollected_Throws()
    {
        var instance = NewDueInstance();
        instance.MarkCollected(UserId.New(), AppRole.Mukadam, DateTime.UtcNow);

        FluentActions.Invoking(() => instance.MarkCollected(
                UserId.New(), AppRole.LabOperator, DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();
    }
}
