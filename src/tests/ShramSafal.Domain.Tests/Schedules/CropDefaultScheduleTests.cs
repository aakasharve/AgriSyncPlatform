// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN carry-in F207 (register F207; founder D-91 = 1, P4, P5).
// A crop's DefaultTemplateId (GET /shramsafal/reference/crop-types and the pull's cropTypes) names a schedule a plot may FOLLOW - the same rule the
// phone's followableDefault.ts reads: an outside schedule ShramSafal has CHECKED (the Institution one first, else the first in the listing's
// order), else - only on a crop with no checked schedule - the first sample, else nothing. It used to be the template with the MOST activities,
// which could be an unchecked sample the phone would never offer, or a row of the farm's own.
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class CropDefaultScheduleTests
{
    private static readonly StageDefinitionDto[] Stages = [new("Pruning", 0, 9), new("Growth", 10, 39)];

    private static IReadOnlyList<TemplateActivityDto> Works(int count) =>
        Enumerable.Range(0, count)
            .Select(i => new TemplateActivityDto("Work " + i, "Monitoring", "Pruning", i, i, "one_time", null))
            .ToList();

    private static ScheduleTemplateDto Row(
        string name, int works, string? scope, string? check, bool? stored, string? owner = null, string crop = "Grapes") =>
        new(Guid.NewGuid(), name, crop, 40, Stages, Works(works), "h",
            OwnerType: owner, Check: check is null ? null : new ScheduleCheckDto(check, null, null, null), HasStoredDays: stored, Scope: scope);

    private static Guid? DefaultOf(params ScheduleTemplateDto[] listing) =>
        GetScheduleTemplatesHandler.BuildCropTypes(listing).Single(c => c.Name == "Grapes").DefaultTemplateId;

    [Fact]
    public void The_biggest_row_being_an_unchecked_sample_does_not_make_it_the_default_when_a_checked_one_exists()
    {
        var sample = Row("Grapes - big sample", 12, null, "NotChecked", null);
        var checkedRow = Row("Grapes - University", 3, "Public", "Checked", true, "INSTITUTION");

        Assert.Equal(checkedRow.Id, DefaultOf(sample, checkedRow));
        Assert.Equal(checkedRow.Id, DefaultOf(checkedRow, sample));
    }

    [Fact]
    public void The_Institution_checked_schedule_comes_first_whatever_the_order_or_the_size()
    {
        var expert = Row("Grapes - Expert", 20, "Public", "Checked", true, "EXPERT");
        var institution = Row("Grapes - University", 2, "Public", "Checked", true, "INSTITUTION");

        Assert.Equal(institution.Id, DefaultOf(expert, institution));
        Assert.Equal(institution.Id, DefaultOf(institution, expert));
    }

    [Fact]
    public void With_no_Institution_one_the_first_checked_in_the_listings_order_is_the_default()
    {
        var first = Row("Grapes - A", 2, "Public", "Checked", true, "EXPERT");
        var second = Row("Grapes - B", 30, "Public", "Checked", true, "EXPERT");

        Assert.Equal(first.Id, DefaultOf(first, second));
        Assert.Equal(second.Id, DefaultOf(second, first));
    }

    [Fact]
    public void A_crop_with_only_samples_defaults_to_the_first_sample()
    {
        var builtIn = Row("Grapes - built-in", 5, null, "NotChecked", null);
        var thin = Row("Grapes - thin row", 9, "Public", "NotChecked", false);

        Assert.Equal(builtIn.Id, DefaultOf(builtIn, thin));
        Assert.Equal(thin.Id, DefaultOf(thin, builtIn));
    }

    [Fact]
    public void A_sample_with_no_check_object_at_all_is_still_a_sample()
    {
        var bare = Row("Grapes - bare", 5, null, null, null);
        Assert.Equal(bare.Id, DefaultOf(bare));
    }

    [Theory]
    [InlineData("Team", "NotChecked", false)]
    [InlineData("Team", "NotChecked", true)]
    [InlineData("Private", "NotChecked", true)]
    [InlineData("Licensed", "NotChecked", true)]
    public void A_row_of_the_farm_itself_is_never_the_default(string scope, string check, bool stored)
    {
        var mine = Row("Grapes - mine", 8, scope, check, stored, "USER");
        Assert.Null(DefaultOf(mine));
    }

    [Fact]
    public void A_withdrawn_or_waiting_or_sent_back_outside_schedule_is_never_the_default()
    {
        var withdrawn = Row("Grapes - withdrawn", 8, "Public", "Withdrawn", true, "INSTITUTION");
        var waiting = Row("Grapes - waiting", 8, "Public", "NotChecked", true, "INSTITUTION");
        var sentBack = Row("Grapes - sent back", 8, "Public", "Returned", true, "INSTITUTION");

        Assert.Null(DefaultOf(withdrawn));
        Assert.Null(DefaultOf(waiting));
        Assert.Null(DefaultOf(sentBack));
        Assert.Null(DefaultOf(withdrawn, waiting, sentBack));
    }

    [Fact]
    public void A_checked_schedule_wins_over_a_sample_and_the_farms_own_rows_never_compete()
    {
        var own = Row("Grapes - mine", 30, "Team", "NotChecked", true, "USER");
        var sample = Row("Grapes - sample", 20, null, "NotChecked", null);
        var checkedRow = Row("Grapes - University", 1, "Public", "Checked", true, "INSTITUTION");

        Assert.Equal(checkedRow.Id, DefaultOf(own, sample, checkedRow));
        Assert.Equal(sample.Id, DefaultOf(own, sample));
    }

    [Fact]
    public void The_crop_is_still_listed_with_no_default_and_its_stages_come_from_the_listed_rows()
    {
        var mine = Row("Grapes - mine", 8, "Team", "NotChecked", true, "USER");

        var crop = GetScheduleTemplatesHandler.BuildCropTypes([mine]).Single();

        Assert.Equal("Grapes", crop.Name);
        Assert.Null(crop.DefaultTemplateId);
        Assert.Equal(["Pruning", "Growth"], crop.Stages);
    }

    [Fact]
    public void Each_crop_gets_its_own_default()
    {
        var grapes = Row("Grapes - University", 2, "Public", "Checked", true, "INSTITUTION");
        var onion = Row("Onion - sample", 2, null, "NotChecked", null, crop: "Onion");

        var crops = GetScheduleTemplatesHandler.BuildCropTypes([grapes, onion]);

        Assert.Equal(grapes.Id, crops.Single(c => c.Name == "Grapes").DefaultTemplateId);
        Assert.Equal(onion.Id, crops.Single(c => c.Name == "Onion").DefaultTemplateId);
    }
}
