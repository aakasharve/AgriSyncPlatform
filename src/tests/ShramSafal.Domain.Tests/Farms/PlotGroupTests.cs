// spec: plr-d10-redesign-real-integration-2026-10-25 - lane GRP-1a (owner-named groups of plots).
// The plot's group label: the one rule for a name, the change that sends it to every phone (ModifiedAtUtc), and the DTO that carries it.
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class PlotGroupTests
{
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly DateTime Created = new(2026, 11, 20, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Later = Created.AddHours(3);

    private static Plot NewPlot() => Plot.Create(Guid.NewGuid(), Farm, "G7", 0.5m, Created);

    [Fact]
    public void A_new_plot_is_in_no_group()
    {
        var plot = NewPlot();
        Assert.Null(plot.GroupName);
        Assert.Equal(Created, plot.ModifiedAtUtc);
    }

    [Fact]
    public void SetGroup_names_the_group_and_moves_the_modified_time_so_the_pull_sends_it()
    {
        var plot = NewPlot();

        var changed = plot.SetGroup("विहिरीजवळचे", Later);

        Assert.True(changed);
        Assert.Equal("विहिरीजवळचे", plot.GroupName);
        Assert.Equal(Later, plot.ModifiedAtUtc);
        Assert.Equal(Created, plot.CreatedAtUtc);
    }

    [Fact]
    public void SetGroup_trims_the_name()
    {
        var plot = NewPlot();
        plot.SetGroup("  वरचा भाग \t", Later);
        Assert.Equal("वरचा भाग", plot.GroupName);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t \n")]
    [InlineData(null)]
    public void SetGroup_with_a_blank_name_means_no_group(string? blank)
    {
        var plot = NewPlot();
        plot.SetGroup("वरचा भाग", Created.AddHours(1));

        var changed = plot.SetGroup(blank, Later);

        Assert.True(changed);
        Assert.Null(plot.GroupName);
        Assert.Equal(Later, plot.ModifiedAtUtc);
    }

    [Fact]
    public void SetGroup_with_null_on_a_plot_that_has_no_group_changes_nothing()
    {
        var plot = NewPlot();

        var changed = plot.SetGroup(null, Later);

        Assert.False(changed);
        Assert.Null(plot.GroupName);
        Assert.Equal(Created, plot.ModifiedAtUtc);
    }

    [Fact]
    public void The_same_name_again_is_a_success_that_changes_and_moves_nothing()
    {
        var plot = NewPlot();
        plot.SetGroup("विहिरीजवळचे", Later);

        var changed = plot.SetGroup("  विहिरीजवळचे ", Later.AddHours(5));

        Assert.False(changed);
        Assert.Equal("विहिरीजवळचे", plot.GroupName);
        Assert.Equal(Later, plot.ModifiedAtUtc);
    }

    [Fact]
    public void A_group_name_may_be_exactly_thirty_characters()
    {
        var plot = NewPlot();
        var name = new string('अ', Plot.GroupNameMaxLength);

        plot.SetGroup(name, Later);

        Assert.Equal(30, Plot.GroupNameMaxLength);
        Assert.Equal(name, plot.GroupName);
    }

    [Fact]
    public void A_group_name_of_thirty_one_characters_is_refused_and_nothing_changes()
    {
        var plot = NewPlot();
        plot.SetGroup("वरचा भाग", Created.AddHours(1));

        var tooLong = new string('अ', Plot.GroupNameMaxLength + 1);
        Assert.Throws<ArgumentException>(() => plot.SetGroup(tooLong, Later));

        Assert.Equal("वरचा भाग", plot.GroupName);
        Assert.Equal(Created.AddHours(1), plot.ModifiedAtUtc);
    }

    [Fact]
    public void The_limit_counts_the_trimmed_name()
    {
        var plot = NewPlot();
        var padded = "  " + new string('अ', Plot.GroupNameMaxLength) + "  ";
        plot.SetGroup(padded, Later);
        Assert.Equal(new string('अ', Plot.GroupNameMaxLength), plot.GroupName);
    }

    [Fact]
    public void NormalizeGroupName_is_the_one_rule()
    {
        Assert.Null(Plot.NormalizeGroupName(null));
        Assert.Null(Plot.NormalizeGroupName("  "));
        Assert.Equal("X", Plot.NormalizeGroupName(" X "));
        Assert.Throws<ArgumentException>(() => Plot.NormalizeGroupName(new string('x', 31)));
    }

    [Fact]
    public void The_dto_carries_the_group()
    {
        var plot = NewPlot();
        plot.SetGroup("विहिरीजवळचे", Later);

        var dto = plot.ToDto();

        Assert.Equal("विहिरीजवळचे", dto.GroupName);
        Assert.Equal(plot.Id, dto.Id);
        Assert.Equal("G7", dto.Name);
        Assert.Equal(Later, dto.ModifiedAtUtc);
    }

    [Fact]
    public void A_plot_with_no_group_maps_to_a_null_group_name()
    {
        Assert.Null(NewPlot().ToDto().GroupName);
    }

    [Fact]
    public void An_old_payload_without_the_field_reads_as_no_group()
    {
        // The DTO's new member is the LAST positional parameter with a default: the older six-argument construction still compiles and means no group.
        var id = Guid.NewGuid();
        var sixArguments = new PlotDto(id, Farm, "G7", 0.5m, Created, Created);
        Assert.Null(sixArguments.GroupName);

        // And a JSON body from a server (or a cached copy) that never had the field reads the same way.
        var json = $$"""{"id":"{{id}}","farmId":"{{Farm.Value}}","name":"G7","areaInAcres":0.5,"createdAtUtc":"2026-11-20T06:00:00Z","modifiedAtUtc":"2026-11-20T06:00:00Z"}""";
        var read = JsonSerializer.Deserialize<PlotDto>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.NotNull(read);
        Assert.Null(read!.GroupName);
    }

    [Fact]
    public void The_dto_sends_the_group_in_camelCase_json()
    {
        var plot = NewPlot();
        plot.SetGroup("वरचा भाग", Later);

        var json = JsonSerializer.Serialize(plot.ToDto(), new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Contains("\"groupName\":", json);
    }
}
