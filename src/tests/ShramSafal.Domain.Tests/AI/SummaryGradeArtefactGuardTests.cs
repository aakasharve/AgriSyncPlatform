// spec: voice-flow-v2-2026-11-23 - the summary must not carry the speech-to-text digit string of a recognised fertilizer grade.
using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class SummaryGradeArtefactGuardTests
{
    private static string RunSummary(string json)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        SummaryGradeArtefactGuard.Apply(root);
        return root["summary"]!.GetValue<string>();
    }

    [Fact]
    public void The_raw_digits_become_the_grade_and_nothing_else_in_the_summary_changes()
    {
        var summary = RunSummary("""
            {"summary":"आज 10 जण आली होती आणि त्यांनी 05234 चं खत दिलं, पानांचा शेंडा मारून घेतला.",
             "inputs":[{"productName":"0-52-34","sourceText":"05234 चं खत दिलं"}]}
            """);

        Assert.Equal("आज 10 जण आली होती आणि त्यांनी 0-52-34 चं खत दिलं, पानांचा शेंडा मारून घेतला.", summary);
    }

    [Fact]
    public void A_colon_grade_is_put_in_as_the_row_carries_it()
    {
        var summary = RunSummary("""{"summary":"आज 191919 दिलं","inputs":[{"productName":"19:19:19"}]}""");

        Assert.Equal("आज 19:19:19 दिलं", summary);
    }

    [Fact]
    public void No_grade_on_any_input_means_no_change()
    {
        const string text = "आज 05234 चं खत दिलं";

        Assert.Equal(text, RunSummary($$"""{"summary":"{{text}}","inputs":[{"productName":"Urea"}]}"""));
        Assert.Equal(text, RunSummary($$"""{"summary":"{{text}}","inputs":[]}"""));
    }

    [Fact]
    public void A_grade_whose_digits_are_not_in_the_summary_changes_nothing()
    {
        const string text = "आज खत दिलं, 10 जण आली होती";

        Assert.Equal(text, RunSummary($$"""{"summary":"{{text}}","inputs":[{"productName":"0-52-34"}]}"""));
    }

    [Fact]
    public void A_longer_number_that_merely_contains_the_digits_is_not_touched()
    {
        const string text = "आज 1052340 रुपये दिले";

        Assert.Equal(text, RunSummary($$"""{"summary":"{{text}}","inputs":[{"productName":"0-52-34"}]}"""));
    }

    [Fact]
    public void An_empty_summary_stays_empty()
    {
        Assert.Equal(string.Empty, RunSummary("""{"summary":"","inputs":[{"productName":"0-52-34"}]}"""));
    }

    [Fact]
    public void The_inputs_themselves_are_never_changed()
    {
        var root = JsonNode.Parse("""
            {"summary":"05234 चं खत दिलं","inputs":[{"productName":"0-52-34","sourceText":"05234 चं खत दिलं"}]}
            """)!.AsObject();

        SummaryGradeArtefactGuard.Apply(root);

        var row = root["inputs"]![0]!;
        Assert.Equal("0-52-34", row["productName"]!.GetValue<string>());
        Assert.Equal("05234 चं खत दिलं", row["sourceText"]!.GetValue<string>());
    }
}
