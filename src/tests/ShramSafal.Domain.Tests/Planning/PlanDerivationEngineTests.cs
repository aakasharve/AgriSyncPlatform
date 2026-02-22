using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlanDerivationEngineTests
{
    [Fact]
    public void DerivePlannedItemsForDay_ReturnsItemsDueOnTargetDay()
    {
        var template = BuildTemplate();
        var startDate = new DateOnly(2026, 1, 1);
        var targetDate = startDate.AddDays(6);

        var planned = PlanDerivationEngine.DerivePlannedItemsForDay(template, startDate, targetDate);

        Assert.Single(planned);
        Assert.Equal("Irrigation", planned[0].ActivityName);
        Assert.Equal(targetDate, planned[0].PlannedDate);
    }

    [Fact]
    public void GetCurrentStage_ResolvesExpectedStageForDay()
    {
        var template = BuildTemplate();

        var stageDay5 = PlanDerivationEngine.GetCurrentStage(template, 5);
        var stageDay18 = PlanDerivationEngine.GetCurrentStage(template, 18);

        Assert.Equal("Vegetative", stageDay5);
        Assert.Equal("Flowering", stageDay18);
    }

    [Fact]
    public void DerivePlannedItemsForStage_ExpandsEveryNDaysFrequency()
    {
        var template = BuildTemplate();
        var startDate = new DateOnly(2026, 1, 1);

        var stageItems = PlanDerivationEngine.DerivePlannedItemsForStage(template, startDate, "Vegetative");
        var irrigationItems = stageItems.Where(x => x.ActivityName == "Irrigation").ToList();

        Assert.True(irrigationItems.Count >= 5);
        Assert.All(irrigationItems, item => Assert.Equal("Vegetative", item.Stage));
    }

    private static ScheduleTemplate BuildTemplate()
    {
        var template = ScheduleTemplate.Create(
            Guid.NewGuid(),
            "Grape Template",
            "Vegetative",
            DateTime.UtcNow,
            [
                new StageDefinition("Vegetative", 0, 14),
                new StageDefinition("Flowering", 15, 30)
            ]);

        template.AddActivity(
            Guid.NewGuid(),
            "Irrigation",
            0,
            FrequencyMode.EveryNDays,
            3);

        template.AddActivity(
            Guid.NewGuid(),
            "Foliar Spray",
            15,
            FrequencyMode.OneTime,
            1);

        return template;
    }
}
