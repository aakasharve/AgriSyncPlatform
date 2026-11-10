// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-137, Q10 = 1; register F224).
// The made-for lists the server checks a tag against: read from the ONE source (sync-contract/schemas/schedule-made-for.json, embedded). Every code is
// a short ASCII code; a Marathi label is DATA for the phone and never a code; a variety is checked per crop code, with `_other` (Local, Hybrid) for a
// crop that has no list. The lists are PROPOSED (unchecked by an agronomist). Pure: no I/O.
using System.Text.RegularExpressions;
using FluentAssertions;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class MadeForListsTests
{
    private static readonly Regex Code = new("^[a-z][a-z0-9_]*$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static ScheduleMadeFor Tag(string? variety = null, string? soil = null, string? region = null, string? climate = null) =>
        new(variety, soil, region, climate);

    [Fact]
    public void Every_soil_climate_and_region_code_is_a_short_ascii_code_in_a_list_of_1_to_8()
    {
        foreach (var (name, list) in new[] { ("soilType", MadeForLists.SoilTypes), ("climate", MadeForLists.Climates), ("region", MadeForLists.Regions) })
        {
            list.Count.Should().BeInRange(1, 8, name);
            list.Should().OnlyHaveUniqueItems(name);
            list.Should().OnlyContain(code => Code.IsMatch(code), name);
        }

        MadeForLists.SoilTypes.Should().Equal("black", "red", "medium", "murum", "sandy");
        MadeForLists.Climates.Should().Equal("dry", "humid", "cold", "hot", "heavy_rain");
        MadeForLists.Regions.Should().Equal("mh", "mh_nashik", "mh_solapur", "mh_pune", "mh_sangli", "mh_satara");
    }

    [Fact]
    public void The_varieties_are_the_phones_own_per_crop_code_minus_Other_and_a_crop_without_a_list_gets_Local_and_Hybrid()
    {
        MadeForLists.VarietiesOf("grape").Should().Equal("Super Sonaka", "Sharad Seedless", "Thompson Seedless", "Crimson Seedless", "Flame Seedless", "Manik Chaman");
        MadeForLists.VarietiesOf("pomegranate").Should().Equal("Bhagwa", "Ganesh", "Mridula", "Arakta");
        MadeForLists.VarietiesOf("tomato").Should().Equal("Abhinav", "Shivam", "Arka Rakshak");
        MadeForLists.VarietiesOf("onion").Should().Equal("Nashik Red", "Puna Fursungi", "N-53");
        foreach (var code in new[] { "_other", "sugarcane", "zzzz", null })
        {
            MadeForLists.VarietiesOf(code).Should().Equal(new[] { "Local", "Hybrid" }, $"crop code {code ?? "null"}");
        }

        foreach (var list in new[] { "grape", "pomegranate", "tomato", "onion", "_other" }.Select(MadeForLists.VarietiesOf))
        {
            list.Should().NotContain("Other");
            list.Should().OnlyContain(v => v.Length >= 1 && v.Length <= ScheduleMadeFor.MaxTagLength);
        }
    }

    [Fact]
    public void Check_accepts_each_listed_value_and_no_tag_at_all()
    {
        MadeForLists.Check("Grapes", ScheduleMadeFor.None).Should().BeNull();
        MadeForLists.Check(null, ScheduleMadeFor.None).Should().BeNull();
        foreach (var soil in MadeForLists.SoilTypes)
        {
            MadeForLists.Check("Grapes", Tag(soil: soil)).Should().BeNull(soil);
        }

        foreach (var climate in MadeForLists.Climates)
        {
            MadeForLists.Check("Grapes", Tag(climate: climate)).Should().BeNull(climate);
        }

        foreach (var region in MadeForLists.Regions)
        {
            MadeForLists.Check("Grapes", Tag(region: region)).Should().BeNull(region);
        }

        MadeForLists.Check("Grapes", Tag("Thompson Seedless", "black", "mh_nashik", "dry")).Should().BeNull("all four at once");
    }

    [Fact]
    public void Check_refuses_a_code_of_another_list_a_Marathi_label_and_Other_with_the_value_and_the_list_in_its_words()
    {
        var otherList = MadeForLists.Check("Grapes", Tag(soil: "dry"));
        otherList.Should().NotBeNull();
        otherList!.Code.Should().Be("ScheduleMadeFor");
        otherList.Message.Should().Contain("\"dry\"").And.Contain("soilType");

        MadeForLists.Check("Grapes", Tag(soil: "काळी"))!.Message.Should().Contain("काळी", "a Marathi label is data for the phone, never a code");
        MadeForLists.Check("Grapes", Tag(climate: "monsoon"))!.Message.Should().Contain("climate");
        MadeForLists.Check("Grapes", Tag(region: "nashik"))!.Message.Should().Contain("region", "not a code of the list (mh_nashik is)");
        MadeForLists.Check("Grapes", Tag(variety: "Other"))!.Message.Should().Contain("variety");
        MadeForLists.Check("Grapes", Tag(soil: "sandyish"))!.Code.Should().Be("ScheduleMadeFor");
        MadeForLists.Check("Grapes", Tag(soil: "Black"))!.Code.Should().Be("ScheduleMadeFor", "codes compare ordinal");
        MadeForLists.Check("Grapes", Tag(soil: new string('s', 41)))!.Code.Should().Be("ScheduleMadeFor");
    }

    [Fact]
    public void A_variety_is_checked_per_crop_code_and_Local_is_accepted_only_for_a_crop_without_a_list()
    {
        MadeForLists.Check("Grapes", Tag(variety: "Thompson Seedless")).Should().BeNull();
        MadeForLists.Check("grape", Tag(variety: "Thompson Seedless")).Should().BeNull("the phone's crop code: Grapes and grape are one crop");
        MadeForLists.Check("Grapes", Tag(variety: "Bhagwa"))!.Message.Should().Contain("Bhagwa", "another crop's variety");
        MadeForLists.Check("Grapes", Tag(variety: "Local"))!.Code.Should().Be("ScheduleMadeFor", "a Grapes schedule may not say Local");
        MadeForLists.Check("Pomegranate", Tag(variety: "Bhagwa")).Should().BeNull();
        MadeForLists.Check("Sugarcane", Tag(variety: "Local")).Should().BeNull("a crop without a list takes _other");
        MadeForLists.Check("Sugarcane", Tag(variety: "Hybrid")).Should().BeNull();
        MadeForLists.Check("Sugarcane", Tag(variety: "Thompson Seedless"))!.Code.Should().Be("ScheduleMadeFor");
        MadeForLists.Check(null, Tag(variety: "Local")).Should().BeNull("no crop key: _other");
        MadeForLists.Check("Zzzz", Tag(variety: "Hybrid")).Should().BeNull("an unknown crop: _other");
    }

    [Fact]
    public void Check_names_the_first_miss_only()
    {
        var problem = MadeForLists.Check("Grapes", Tag("Bhagwa", "sandyish", null, null));
        problem!.Message.Should().Contain("Bhagwa").And.NotContain("sandyish");
    }
}
