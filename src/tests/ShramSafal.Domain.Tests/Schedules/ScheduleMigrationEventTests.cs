using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleMigrationEventTests
{
    private static ScheduleMigrationEvent Record(
        ScheduleSubscriptionId? prev = null,
        ScheduleSubscriptionId? next = null,
        decimal compliancePct = 42m)
    {
        return ScheduleMigrationEvent.Record(
            Guid.NewGuid(),
            prev ?? ScheduleSubscriptionId.New(),
            next ?? ScheduleSubscriptionId.New(),
            ScheduleTemplateId.New(),
            ScheduleTemplateId.New(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTime.UtcNow,
            ScheduleMigrationReason.BetterFit,
            "trying organic",
            compliancePct,
            new UserId(Guid.NewGuid()));
    }

    [Fact]
    public void Record_ValidInputs_PopulatesAllFields()
    {
        var evt = Record();
        Assert.NotEqual(Guid.Empty, evt.EventId);
        Assert.Equal(ScheduleMigrationReason.BetterFit, evt.Reason);
        Assert.Equal("trying organic", evt.ReasonText);
        Assert.Equal(42m, evt.ComplianceAtMigrationPct);
    }

    [Fact]
    public void Record_SameSubscriptionForPrevAndNew_Throws()
    {
        var same = ScheduleSubscriptionId.New();
        Assert.Throws<InvalidOperationException>(() => Record(same, same));
    }

    [Theory]
    [InlineData(-0.01)]
    [InlineData(100.01)]
    public void Record_ComplianceOutsideRange_Throws(decimal pct)
    {
        Assert.Throws<ArgumentException>(() => Record(compliancePct: pct));
    }

    [Fact]
    public void Record_TrimsReasonText()
    {
        var evt = ScheduleMigrationEvent.Record(
            Guid.NewGuid(),
            ScheduleSubscriptionId.New(),
            ScheduleSubscriptionId.New(),
            ScheduleTemplateId.New(),
            ScheduleTemplateId.New(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTime.UtcNow,
            ScheduleMigrationReason.Other,
            "  switched  ",
            0m,
            new UserId(Guid.NewGuid()));

        Assert.Equal("switched", evt.ReasonText);
    }

    [Fact]
    public void Record_EmptyReasonText_StoresNull()
    {
        var evt = ScheduleMigrationEvent.Record(
            Guid.NewGuid(),
            ScheduleSubscriptionId.New(),
            ScheduleSubscriptionId.New(),
            ScheduleTemplateId.New(),
            ScheduleTemplateId.New(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTime.UtcNow,
            ScheduleMigrationReason.Other,
            "   ",
            0m,
            new UserId(Guid.NewGuid()));

        Assert.Null(evt.ReasonText);
    }
}
