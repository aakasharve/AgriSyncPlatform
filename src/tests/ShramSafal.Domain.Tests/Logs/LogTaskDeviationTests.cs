using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class LogTaskDeviationTests
{
    private static DailyLog MakeLog() =>
        DailyLog.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            Guid.NewGuid(),
            new UserId(Guid.NewGuid()),
            DateOnly.FromDateTime(DateTime.Today),
            null,
            null,
            DateTime.UtcNow);

    [Fact]
    public void AddTask_SkippedWithoutReason_Throws()
    {
        var log = MakeLog();
        var act = () => log.AddTask(Guid.NewGuid(), "spray", null, DateTime.UtcNow,
            ExecutionStatus.Skipped, deviationReasonCode: null);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void AddTask_CompletedWithReason_Throws()
    {
        var log = MakeLog();
        var act = () => log.AddTask(Guid.NewGuid(), "spray", null, DateTime.UtcNow,
            ExecutionStatus.Completed, deviationReasonCode: "weather.rain");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void AddTask_Partial_AcceptsReasonAndNote()
    {
        var log = MakeLog();
        var task = log.AddTask(Guid.NewGuid(), "spray", null, DateTime.UtcNow,
            ExecutionStatus.Partial, deviationReasonCode: "weather.rain", deviationNote: "Heavy rain");
        task.ExecutionStatus.Should().Be(ExecutionStatus.Partial);
        task.DeviationReasonCode.Should().Be("weather.rain");
        task.DeviationNote.Should().Be("Heavy rain");
    }

    [Fact]
    public void AddTask_Completed_DefaultsWork()
    {
        var log = MakeLog();
        var task = log.AddTask(Guid.NewGuid(), "spray", null, DateTime.UtcNow);
        task.ExecutionStatus.Should().Be(ExecutionStatus.Completed);
        task.DeviationReasonCode.Should().BeNull();
        task.DeviationNote.Should().BeNull();
    }

    [Fact]
    public void AddTask_Delayed_RequiresReason()
    {
        var log = MakeLog();
        var task = log.AddTask(Guid.NewGuid(), "spray", null, DateTime.UtcNow,
            ExecutionStatus.Delayed, deviationReasonCode: "labour.absent");
        task.ExecutionStatus.Should().Be(ExecutionStatus.Delayed);
        task.DeviationReasonCode.Should().Be("labour.absent");
    }

    [Fact]
    public void AddTask_Modified_RequiresReason()
    {
        var log = MakeLog();
        var task = log.AddTask(Guid.NewGuid(), "fertigation", null, DateTime.UtcNow,
            ExecutionStatus.Modified, deviationReasonCode: "instruction.changed");
        task.ExecutionStatus.Should().Be(ExecutionStatus.Modified);
        task.DeviationReasonCode.Should().Be("instruction.changed");
    }
}
