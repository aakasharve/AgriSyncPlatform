using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class CropScheduleTemplateTests
{
    [Fact]
    public void Create_SortsTasksByDayOffsetThenTaskType()
    {
        var tasks = new[]
        {
            PrescribedTask.Create(PrescribedTaskId.New(), "pruning", "growth", 60),
            PrescribedTask.Create(PrescribedTaskId.New(), "fertigation", "growth", 14),
            PrescribedTask.Create(PrescribedTaskId.New(), "spray", "vegetative", 14),
        };

        var template = CropScheduleTemplate.Create(
            Guid.NewGuid(),
            "grape_nashik_standard_v1",
            "Grape",
            "nashik",
            "North Maharashtra Grape Standard",
            "v1.0",
            DateTime.UtcNow,
            tasks);

        Assert.Collection(template.Tasks,
            t => Assert.Equal(("fertigation", 14), (t.TaskType, t.DayOffsetFromCycleStart)),
            t => Assert.Equal(("spray", 14), (t.TaskType, t.DayOffsetFromCycleStart)),
            t => Assert.Equal(("pruning", 60), (t.TaskType, t.DayOffsetFromCycleStart)));
    }

    [Fact]
    public void Create_NormalizesCropAndRegionKeys()
    {
        var template = CropScheduleTemplate.Create(
            Guid.NewGuid(),
            "grape_nashik_standard_v1",
            "  GRAPE ",
            " NASHIK ",
            "Standard",
            "v1",
            DateTime.UtcNow);

        Assert.Equal("grape", template.CropKey);
        Assert.Equal("nashik", template.RegionCode);
    }

    [Fact]
    public void Create_RegionCodeOptional()
    {
        var template = CropScheduleTemplate.Create(
            Guid.NewGuid(),
            "onion_rabi_standard_v1",
            "onion",
            null,
            "Onion Rabi Standard",
            "v1",
            DateTime.UtcNow);

        Assert.Null(template.RegionCode);
    }

    [Theory]
    [InlineData("", "cropKey", "name", "v1")]
    [InlineData("grape", "", "name", "v1")]
    [InlineData("grape", "cropKey", "", "v1")]
    [InlineData("grape", "cropKey", "name", "")]
    public void Create_RequiredFields_Throws(string templateKey, string cropKey, string name, string version)
    {
        Assert.Throws<ArgumentException>(() => CropScheduleTemplate.Create(
            Guid.NewGuid(),
            templateKey,
            cropKey,
            null,
            name,
            version,
            DateTime.UtcNow));
    }

    [Fact]
    public void Publish_WithZeroTasks_Throws()
    {
        var template = CropScheduleTemplate.Create(
            Guid.NewGuid(),
            "empty_v1",
            "grape",
            null,
            "Empty",
            "v1",
            DateTime.UtcNow);

        Assert.Throws<InvalidOperationException>(() => template.Publish());
    }

    [Fact]
    public void Publish_WithTasks_MarksPublished()
    {
        var tasks = new[] { PrescribedTask.Create(PrescribedTaskId.New(), "spray", "growth", 14) };
        var template = CropScheduleTemplate.Create(
            Guid.NewGuid(),
            "grape_v1",
            "grape",
            null,
            "Grape",
            "v1",
            DateTime.UtcNow,
            tasks);

        template.Publish();

        Assert.True(template.IsPublished);
    }

    [Fact]
    public void PrescribedTask_Create_DefaultsToleranceTo2Days()
    {
        var task = PrescribedTask.Create(PrescribedTaskId.New(), "spray", "growth", 10);

        Assert.Equal(PrescribedTask.DefaultToleranceDays, task.ToleranceDaysPlusMinus);
    }

    [Fact]
    public void PrescribedTask_Create_NegativeToleranceThrows()
    {
        Assert.Throws<ArgumentException>(() =>
            PrescribedTask.Create(PrescribedTaskId.New(), "spray", "growth", 10, -1));
    }
}
