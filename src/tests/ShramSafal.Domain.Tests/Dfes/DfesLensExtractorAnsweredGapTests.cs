using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-2). Founder ruling A:
/// answering Sathi's gap question must raise the day's score. These tests exercise
/// <see cref="DfesLensExtractor"/>'s crediting of <see cref="AnsweredGap"/> into the
/// completeness roster that <see cref="DayUnderstandingScore"/> divides by.
///
/// <para>Controller Ruling R2 (binding): the creditable set is EXACTLY the
/// dimensions the extractor already weighs — WHAT, DOSE, CARRIER, COST, WEATHER.
/// SCOPE / PURPOSE / CONTINUITY carry no weight in the extractor (SCOPE was
/// deliberately removed; PURPOSE/CONTINUITY never had one), so an answered gap for
/// any of them credits nothing — never invent a weight (doctrine P4).</para>
/// </summary>
public sealed class DfesLensExtractorAnsweredGapTests
{
    private static readonly DateOnly Today = new(2026, 8, 14);

    // He sprayed. No product, no dose, no cost, no weather, nothing noticed.
    private const string OneActivityNoDose = """
    { "summary": "kaam kela", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // The very same day, fully described: product + dose stated directly.
    private const string OneActivityWithDose = """
    { "summary": "sprayed with MKP, 4kg", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "productName": "MKP", "mix": [ { "productName": "MKP", "dose": 4, "unit": "kg" } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    [Fact]
    public void An_answered_DOSE_gap_raises_the_score_and_never_lowers_it()
    {
        var day = MinimalWorkDay();                        // one activity, no dose
        var withoutAnswer = ScoreOf(day with { AnsweredGaps = [] });
        var withAnswer = ScoreOf(day with
        {
            AnsweredGaps = [new AnsweredGap("DOSE", Today)],
        });

        withAnswer.Should().BeGreaterThan(withoutAnswer);
    }

    [Fact]
    public void An_answered_gap_never_exceeds_what_logging_it_directly_would_earn()
    {
        var answered = ScoreOf(MinimalWorkDay() with
        {
            AnsweredGaps = [new AnsweredGap("DOSE", Today)],
        });
        var logged = ScoreOf(WorkDayWithDose());

        answered.Should().BeLessThanOrEqualTo(logged);
    }

    [Fact]
    public void An_answered_gap_on_an_already_covered_dimension_credits_nothing_extra()
    {
        var day = WorkDayWithDose();                        // DOSE already fully covered
        var withoutGap = ScoreOf(day with { AnsweredGaps = [] });
        var withGap = ScoreOf(day with
        {
            AnsweredGaps = [new AnsweredGap("DOSE", Today)],
        });

        withGap.Should().Be(withoutGap,
            "DOSE is already fully covered by the logged data — answering it again must not add a second point");
    }

    [Theory]
    [InlineData("SCOPE")]
    [InlineData("PURPOSE")]
    [InlineData("CONTINUITY")]
    public void Answering_a_dimension_with_no_extractor_weight_credits_nothing(string dimension)
    {
        var day = MinimalWorkDay();
        var withoutGap = ScoreOf(day with { AnsweredGaps = [] });
        var withGap = ScoreOf(day with
        {
            AnsweredGaps = [new AnsweredGap(dimension, Today)],
        });

        withGap.Should().Be(withoutGap,
            $"{dimension} carries no weight in the extractor — crediting it would be a fabricated number");
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static DfesLensExtractor.DayData MinimalWorkDay() => Day(OneActivityNoDose);

    private static DfesLensExtractor.DayData WorkDayWithDose() => Day(OneActivityWithDose);

    private static DfesLensExtractor.DayData Day(string json)
    {
        // .Clone() detaches the element from its JsonDocument so the DayData built
        // here stays valid after this method returns (the document itself is never
        // kept alive — see DfesLensExtractorCompletenessTests.Run for the sibling
        // idiom, which instead keeps the `using` scope open around the Build call).
        var root = JsonDocument.Parse(json).RootElement.Clone();
        return new DfesLensExtractor.DayData([root], []);
    }

    private static int ScoreOf(DfesLensExtractor.DayData day)
    {
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(day, probe, clientDatePlausible: true);
        var score = DayUnderstandingScore.From(input);
        score.Should().NotBeNull();
        return score!.Value;
    }
}
