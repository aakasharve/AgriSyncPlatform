using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lane AI-2 FIX PASS 4 (live on 9463a153). Entry labour {HIRED, female, femaleCount 5, count 5} corrected with
/// "5 बायका नाही, 6 बायका होत्या" came back {femaleCount 6, count 5}: the guard copied the entry's count as an
/// unchanged field while the gender count changed, so the row disagreed with itself (P4). The count follows the
/// gender counts: worked out again when the entry's count was their sum, dropped when it was said on its own, never
/// copied beside numbers it contradicts.
/// </summary>
public sealed class PlrV1FixPass4Tests
{
    private const string Female = """{"labour":[{"type":"HIRED","gender":"female","femaleCount":5,"count":5}]}""";
    private const string Male = """{"labour":[{"type":"HIRED","gender":"male","maleCount":3,"count":3}]}""";
    private const string Mixed = """{"labour":[{"type":"HIRED","femaleCount":5,"maleCount":2,"count":7}]}""";
    private const string CountSaidOnItsOwn = """{"labour":[{"type":"HIRED","femaleCount":6,"count":10}]}""";

    [Theory]
    [InlineData("""{"labour":[{"femaleCount":6}]}""")]
    [InlineData("""{"labour":[{"femaleCount":6,"count":5}]}""")] // the live answer
    [InlineData("""{"labour":[{"type":"HIRED","gender":"female","femaleCount":6,"count":6}]}""")]
    [InlineData("""{"labour":[{"femaleCount":6,"count":"5"}]}""")]
    [InlineData("""{"labour":[{"femaleCount":"6","gender":"unknown"}]}""")]
    public void Female_only_the_count_follows_the_women(string answer)
    {
        var row = Row(Guard(Female, "5 बायका नाही, 6 बायका होत्या", answer));

        Assert.Equal(6m, Number(row["femaleCount"]));
        Assert.Equal(6m, Number(row["count"]));
        Assert.Equal("female", row["gender"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("""{"labour":[{"maleCount":4}]}""")]
    [InlineData("""{"labour":[{"maleCount":4,"count":3}]}""")]
    [InlineData("""{"labour":[{"type":"HIRED","gender":"male","maleCount":4,"count":4}]}""")]
    public void Male_only_the_count_follows_the_men(string answer)
    {
        var row = Row(Guard(Male, "3 पुरुष नाही, 4 पुरुष होते", answer));

        Assert.Equal(4m, Number(row["maleCount"]));
        Assert.Equal(4m, Number(row["count"]));
    }

    [Theory]
    [InlineData("""{"labour":[{"femaleCount":6}]}""")]
    [InlineData("""{"labour":[{"femaleCount":6,"maleCount":2,"count":7}]}""")]
    [InlineData("""{"labour":[{"femaleCount":6,"count":6}]}""")] // the women's number taken for the whole count
    [InlineData("""{"labour":[{"type":"HIRED","femaleCount":6,"maleCount":2,"count":8}]}""")]
    public void Mixed_five_and_two_becomes_six_and_two_and_the_count_eight(string answer)
    {
        var row = Row(Guard(Mixed, "5 बायका नाही, 6 बायका होत्या", answer));

        Assert.Equal(6m, Number(row["femaleCount"]));
        Assert.Equal(2m, Number(row["maleCount"]));
        Assert.Equal(8m, Number(row["count"]));
    }

    [Theory]
    [InlineData("""{"labour":[{"femaleCount":7}]}""")]
    [InlineData("""{"labour":[{"femaleCount":7,"count":10}]}""")]
    [InlineData("""{"labour":[{"femaleCount":7,"count":11}]}""")] // a count he never said
    public void A_count_said_on_its_own_is_dropped_not_kept_stale(string answer)
    {
        var row = Row(Guard(CountSaidOnItsOwn, "6 बायका नाही, 7 बायका होत्या", answer));

        Assert.Equal(7m, Number(row["femaleCount"]));
        Assert.False(row.ContainsKey("count"), $"stale count kept: {row.ToJsonString()}");
    }

    [Fact]
    public void A_new_count_he_says_with_the_change_stays()
    {
        var row = Row(Guard(CountSaidOnItsOwn, "6 बायका नाही, 7 बायका होत्या, एकूण 11 जण होते", """{"labour":[{"femaleCount":7,"count":11}]}"""));

        Assert.Equal(7m, Number(row["femaleCount"]));
        Assert.Equal(11m, Number(row["count"]));
    }

    [Fact]
    public void A_correction_of_something_else_leaves_the_labour_count_alone()
    {
        const string entry = """{"irrigation":[{"method":"Drip","durationHours":2}],"labour":[{"type":"HIRED","gender":"female","femaleCount":5,"count":5}]}""";

        var guarded = Guard(entry, "पाणी 2 तास नव्हतं, 3 तास दिलं", """{"irrigation":[{"durationHours":3}],"labour":[{"femaleCount":5}]}""");

        var row = Row(guarded);
        Assert.Equal(5m, Number(row["femaleCount"]));
        Assert.Equal(5m, Number(row["count"]));
        Assert.Equal(3m, Number(guarded["irrigation"]![0]!["durationHours"]));
    }

    private static JsonObject Guard(string entry, string words, string answer)
    {
        using var doc = JsonDocument.Parse(entry);
        return JsonNode.Parse(CorrectionGuard.Apply(answer, doc.RootElement, words))!.AsObject();
    }

    private static JsonObject Row(JsonObject guarded) => Assert.Single(guarded["labour"]!.AsArray())!.AsObject();

    private static decimal Number(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<decimal>(out var d) ? d
        : node is JsonValue s && s.TryGetValue<string>(out var text) ? decimal.Parse(text, CultureInfo.InvariantCulture)
        : throw new Xunit.Sdk.XunitException($"not a number: {node?.ToJsonString() ?? "missing"}");
}
