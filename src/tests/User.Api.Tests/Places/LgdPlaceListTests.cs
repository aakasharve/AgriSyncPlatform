// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S0) - the government village list the server embeds.
using System.IO;
using System.Linq;
using FluentAssertions;
using User.Infrastructure.Places;
using Xunit;

namespace User.Api.Tests.Places;

/// <summary>
/// The embedded list is the founder's CSV as built by <c>ops/places/build_place_list.py</c>: the counts the contract measured, the version
/// string the phone's file must carry, the provenance mark on every row, and nothing filled in that the list does not hold.
/// </summary>
public sealed class LgdPlaceListTests
{
    private const string Header = "#v-test\tsource=test source\tprovenance=Secondary source; not independently verified\tvillages={0}\ttalukas=1\tdistricts=1\n"
        + "code\ttaluka\tmr\ten\tpin\tstatus\n";

    private const string Areas = """
        {"version":"v-test","districts":[{"code":496,"en":"Solapur","mr":"सोलापूर"}],"talukas":[{"code":4249,"district":496,"en":"Pandharpur"}]}
        """;

    [Fact]
    public void The_embedded_list_holds_44930_villages_358_talukas_and_35_districts_of_version_lgd_mh_2026_11_26()
    {
        var list = LgdPlaceList.Current;

        list.Version.Should().Be("lgd-mh-2026-11-26").And.Be(LgdPlaceList.CurrentVersion);
        list.Villages.Should().HaveCount(44930);
        list.Talukas.Should().HaveCount(358);
        list.Districts.Should().HaveCount(35);
        list.Provenance.Should().Be("Secondary source; not independently verified");
        list.Source.Should().Be("LGD mirror 2026-11-26 (villages + pincode_villages parquet)");
    }

    [Fact]
    public void Nothing_missing_in_the_list_is_filled_in()
    {
        var list = LgdPlaceList.Current;

        list.Villages.Count(v => v.NameMr is null).Should().Be(42, "the list has 42 villages with no Marathi name; none is translated");
        list.Villages.Count(v => v.Pin is null).Should().Be(125, "the list has 125 villages with no PIN; none is guessed");
        list.Villages.Count(v => v.Status == LgdVillageStatus.Inhabited).Should().Be(44605);
        list.Villages.Count(v => v.Status == LgdVillageStatus.Uninhabited).Should().Be(320);
        list.Villages.Count(v => v.Status == LgdVillageStatus.Forest).Should().Be(5);
        list.Villages.Select(v => v.Code).Should().OnlyHaveUniqueItems("the village LGD code is the join key");
        list.Districts.Should().OnlyContain(d => d.NameMr.Length > 0, "every district's Marathi name comes from the district sheet");
        list.Districts.Should().NotContain(d => d.Code == 482, "Mumbai has no village in the list");
    }

    [Fact]
    public void Pandharpur_is_found_by_its_code_with_its_taluka_and_district()
    {
        var list = LgdPlaceList.Current;

        var village = list.Villages.Single(v => v.Code == 944182);
        village.NameMr.Should().Be("पंढरपूर");
        village.NameEn.Should().Be("Pandharpur");
        village.Pin.Should().Be("413304");
        var taluka = list.Talukas.Single(t => t.Code == village.TalukaCode);
        taluka.Should().Be(new LgdTalukaRow(4249, 496, "Pandharpur"));
        list.Districts.Single(d => d.Code == taluka.DistrictCode).Should().Be(new LgdDistrictRow(496, "Solapur", "सोलापूर"));
        list.Villages.Count(v => v.NameMr == "चिखली").Should().BeGreaterThan(1, "a name repeats across talukas; the code tells them apart");
    }

    [Fact]
    public void No_name_carries_a_tab_or_stray_spaces()
    {
        var names = LgdPlaceList.Current.Villages.SelectMany(v => new[] { v.NameMr, v.NameEn }).OfType<string>().ToList();

        names.Should().OnlyContain(n => n == n.Trim() && !n.Contains('\t') && !n.Contains("  "),
            "the source has trailing tabs and double spaces in some Marathi names; the build removes only those");
    }

    [Fact]
    public void A_file_whose_rows_differ_from_its_version_line_is_refused_with_the_counts()
    {
        var tsv = string.Format(Header, 3) + "944182\t4249\tपंढरपूर\tPandharpur\t413304\tI\n562358\t4249\tआढीव\tAdhiv\t413304\tI\n";

        var act = () => LgdPlaceList.Parse("v-test", new StringReader(tsv), new StringReader(Areas));

        act.Should().Throw<InvalidDataException>().WithMessage(
            "Place list v-test: the files hold 2 villages, 1 talukas and 1 districts; the version line says 3, 1 and 1. Nothing was loaded.");
    }

    [Theory]
    [InlineData("944182\t4249\tपंढरपूर\tPandharpur\t413304\tI\n944182\t4249\tपंढरपूर\tPandharpur\t413304\tI\n", "village 944182 is listed twice")]
    [InlineData("944182\t9999\tपंढरपूर\tPandharpur\t413304\tI\n", "village 944182 names taluka 9999, which is not listed")]
    [InlineData("944182\t4249\tपंढरपूर\tPandharpur\t013304\tI\n", "village 944182 has a PIN that is not six digits")]
    [InlineData("944182\t4249\tपंढरपूर\tPandharpur\t413304\tX\n", "village 944182 has an unknown status 'X'")]
    [InlineData("944182\t4249\tपंढरपूर\t\t413304\tI\n", "village 944182 has no English name")]
    public void A_row_that_does_not_hold_together_is_refused_by_name(string rows, string reason)
    {
        var tsv = string.Format(Header, rows.Count(c => c == '\n')) + rows;

        var act = () => LgdPlaceList.Parse("v-test", new StringReader(tsv), new StringReader(Areas));

        act.Should().Throw<InvalidDataException>().WithMessage($"Place list v-test: {reason}. Nothing was loaded.");
    }

    [Fact]
    public void A_taluka_with_a_Marathi_name_is_refused_while_founder_question_8_is_open()
    {
        var areas = Areas.Replace("\"en\":\"Pandharpur\"", "\"en\":\"Pandharpur\",\"mr\":\"पंढरपूर\"");
        var tsv = string.Format(Header, 1) + "944182\t4249\tपंढरपूर\tPandharpur\t413304\tI\n";

        var act = () => LgdPlaceList.Parse("v-test", new StringReader(tsv), new StringReader(areas));

        act.Should().Throw<InvalidDataException>().WithMessage(
            "Place list v-test: a taluka carries a Marathi name; none is loaded until founder question 8 is answered. Nothing was loaded.");
    }

    [Fact]
    public void A_file_of_another_version_is_refused()
    {
        var tsv = string.Format(Header, 1).Replace("#v-test", "#v-other") + "944182\t4249\tपंढरपूर\tPandharpur\t413304\tI\n";

        var act = () => LgdPlaceList.Parse("v-test", new StringReader(tsv), new StringReader(Areas));

        act.Should().Throw<InvalidDataException>().WithMessage("Place list v-test: the village file names version 'v-other'. Nothing was loaded.");
    }
}
