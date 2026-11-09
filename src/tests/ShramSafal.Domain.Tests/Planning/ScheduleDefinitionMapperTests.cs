using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-GATE-a Task 1 (R28, R34, P4). The ONE mapper from a listed
/// schedule to the engine's <see cref="ScheduleDefinition"/>: stored stages only for a row that stores its days; a Part the engine
/// reads in lower case; the days (EndDay, repeat) only when the schedule STORES them - never from the words (P4).
/// </summary>
public sealed class ScheduleDefinitionMapperTests
{
    private static readonly Guid TemplateId = Guid.NewGuid();
    private static readonly DateOnly DayZero = new(2026, 1, 1);

    private static TemplateActivityDto Stored(
        Guid id, string name, string part, int start, int end, string mode, int? interval,
        Guid? after = null, string? op = null, string? role = null, string? nutrient = null) =>
        new(name, part == "Irrigation" ? "Irrigation" : part == "Nutrition" ? "Fertigation" : part == "Spray" ? "Spraying" : "Pruning",
            "Growth", start, end, mode switch { "EveryNDays" => "every_n_days", "PerWeek" => "per_week", _ => "one_time" }, interval,
            OperationKey: op, Id: id, Part: part, Role: role, NutrientKey: nutrient, AfterActivityId: after, StoredFrequencyMode: mode);

    private static ScheduleTemplateDto Template(bool stored, params TemplateActivityDto[] activities) =>
        new(TemplateId, "University grapes", "Grapes", 80,
            stored ? [new StageDefinitionDto("Pruning", 0, 9), new StageDefinitionDto("Growth", 10, 39)] : [new StageDefinitionDto("Pruning", 0, 59)],
            activities, "h", HasStoredDays: stored, Scope: stored ? "Public" : null);

    [Fact]
    public void Part_is_lower_cased_from_the_stored_name()
    {
        var def = ScheduleDefinitionMapper.From(Template(true,
            Stored(Guid.NewGuid(), "Drip", "Irrigation", 0, 20, "EveryNDays", 3),
            Stored(Guid.NewGuid(), "Feed", "Nutrition", 0, 20, "EveryNDays", 7),
            Stored(Guid.NewGuid(), "Spray", "Spray", 5, 5, "OneTime", null),
            Stored(Guid.NewGuid(), "Prune", "Work", 1, 1, "OneTime", null)));

        Assert.Equal(["irrigation", "nutrition", "spray", "work"], def.Activities.Select(a => a.Part));
    }

    [Fact]
    public void A_stored_row_keeps_its_days_ids_order_and_keys()
    {
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        var def = ScheduleDefinitionMapper.From(Template(true,
            Stored(first, "Prune", "Work", 1, 1, "OneTime", null, op: "op_pruning"),
            Stored(second, "Drip", "Irrigation", 2, 30, "PerWeek", 2, after: first, role: "Water", nutrient: "N")));

        Assert.Equal(TemplateId, def.TemplateId);
        Assert.Equal("University grapes", def.Name);
        Assert.Equal([new StageDefinition("Pruning", 0, 9), new StageDefinition("Growth", 10, 39)], def.Stages);
        Assert.Equal(first, def.Activities[0].ActivityId);
        Assert.Equal(FrequencyMode.OneTime, def.Activities[0].FrequencyMode);
        Assert.Equal("op_pruning", def.Activities[0].OperationKey);
        Assert.Equal(second, def.Activities[1].ActivityId);
        Assert.Equal(first, def.Activities[1].AfterActivityId);
        Assert.Equal(2, def.Activities[1].StartDay);
        Assert.Equal(30, def.Activities[1].EndDay);
        Assert.Equal(FrequencyMode.PerWeek, def.Activities[1].FrequencyMode);
        Assert.Equal(2, def.Activities[1].IntervalDays);
        Assert.Equal("Water", def.Activities[1].Role);
        Assert.Equal("N", def.Activities[1].NutrientKey);
        Assert.Equal("Drip", def.Activities[1].Title);
    }

    [Fact]
    public void A_stored_activity_expands_to_the_engines_dates()
    {
        var def = ScheduleDefinitionMapper.From(Template(true, Stored(Guid.NewGuid(), "Drip", "Irrigation", 0, 9, "EveryNDays", 3)));

        var plan = ScheduleFollowEngine.StagePlan(def, DayZero, new StageWindow("Pruning", DayZero, DayZero.AddDays(9)));

        Assert.Equal([0, 3, 6, 9], plan.Single().Dates!.Select(d => d.DayNumber - DayZero.DayNumber));
        Assert.Equal(4, plan.Single().TimesInStage);
    }

    [Fact]
    public void A_thin_row_has_no_stages_and_no_days_so_the_engine_expands_nothing()
    {
        // A built-in / thin row: the listed stage, end day and repeat are INVENTED by the library; only the start day is stored.
        var thin = new TemplateActivityDto("Drip Irrigation", "Irrigation", "Pruning", 4, 4, "every_n_days", 3);
        var def = ScheduleDefinitionMapper.From(Template(false, thin));

        Assert.Empty(def.Stages);
        var activity = Assert.Single(def.Activities);
        Assert.Null(activity.EndDay);
        Assert.Null(activity.FrequencyMode);
        Assert.Null(activity.IntervalDays);
        Assert.Empty(ScheduleFollowEngine.Expand(def, DayZero));

        var plan = ScheduleFollowEngine.StagePlan(def, DayZero, new StageWindow("any", DayZero, DayZero.AddDays(10)));
        var line = Assert.Single(plan);
        Assert.Null(line.Dates);
        Assert.Null(line.TimesInStage);
    }

    [Theory]
    [InlineData("Irrigation", "irrigation")]
    [InlineData("Fertigation", "nutrition")]
    [InlineData("Spraying", "spray")]
    [InlineData("Pruning", "work")]
    [InlineData("Weeding", "work")]
    [InlineData("Harvest", "work")]
    [InlineData("Cultural", "work")]
    public void A_words_only_part_comes_from_the_category_fold_and_still_expands_nothing(string category, string part)
    {
        // The phone's partOf: irrigation / fertigation / foliar spray are their own part; every other category is "work".
        var thin = new TemplateActivityDto("Something", category, "Pruning", 2, 2, "every_n_days", 5);
        var def = ScheduleDefinitionMapper.From(Template(false, thin));

        Assert.Equal(part, def.Activities.Single().Part);
        Assert.Null(def.Activities.Single().EndDay);
        Assert.Empty(ScheduleFollowEngine.Expand(def, DayZero));
    }

    [Fact]
    public void A_stored_part_wins_over_the_category()
    {
        var def = ScheduleDefinitionMapper.From(Template(true, Stored(Guid.NewGuid(), "Feed", "Nutrition", 0, 9, "OneTime", null)));

        Assert.Equal("nutrition", def.Activities.Single().Part);
    }

    [Fact]
    public void A_stored_activity_without_a_stored_repeat_has_no_days()
    {
        // HasStoredDays on the row, but this activity stores no repeat: no end day, no repeat - the engine must not guess one.
        var odd = new TemplateActivityDto("Odd", "Irrigation", "Growth", 3, 9, "every_n_days", 2, Id: Guid.NewGuid(), Part: "Irrigation", StoredFrequencyMode: null);
        var def = ScheduleDefinitionMapper.From(Template(true, odd));

        Assert.Null(def.Activities.Single().EndDay);
        Assert.Null(def.Activities.Single().FrequencyMode);
        Assert.Empty(ScheduleFollowEngine.Expand(def, DayZero));
    }

    [Fact]
    public void An_activity_with_no_id_gets_a_stable_id_from_its_template_and_place()
    {
        var a = new TemplateActivityDto("One", "Irrigation", "S", 0, 0, "one_time", null);
        var b = new TemplateActivityDto("Two", "Irrigation", "S", 1, 1, "one_time", null);

        var first = ScheduleDefinitionMapper.From(Template(false, a, b));
        var again = ScheduleDefinitionMapper.From(Template(false, a, b));
        var other = ScheduleDefinitionMapper.From(Template(false, a, b) with { Id = Guid.NewGuid() });

        Assert.NotEqual(first.Activities[0].ActivityId, first.Activities[1].ActivityId);
        Assert.Equal(first.Activities.Select(x => x.ActivityId), again.Activities.Select(x => x.ActivityId));
        Assert.NotEqual(first.Activities[0].ActivityId, other.Activities[0].ActivityId);
        Assert.NotEqual(Guid.Empty, first.Activities[0].ActivityId);
    }

    [Fact]
    public void The_stage_holding_a_day_is_the_first_by_start_day_and_names_its_window()
    {
        var def = ScheduleDefinitionMapper.From(Template(true));

        var inGrowth = ScheduleDefinitionMapper.StageHolding(def, DayZero, DayZero.AddDays(12));
        var before = ScheduleDefinitionMapper.StageHolding(def, DayZero, DayZero.AddDays(-1));
        var after = ScheduleDefinitionMapper.StageHolding(def, DayZero, DayZero.AddDays(40));

        Assert.Equal(new StageDefinition("Growth", 10, 39), inGrowth!.Value.Stage);
        Assert.Equal(new StageWindow("Growth", DayZero.AddDays(10), DayZero.AddDays(39)), inGrowth.Value.Window);
        Assert.Null(before);
        Assert.Null(after);
    }
}
