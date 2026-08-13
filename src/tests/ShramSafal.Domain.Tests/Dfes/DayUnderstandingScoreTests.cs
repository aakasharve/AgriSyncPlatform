using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (Slice 3a). Locks the dimension→/10 rollup:
/// covered weight ÷ POSSIBLE weight against a fixed denominator, rounded
/// away-from-zero, clamped to 0–10. A dimension that cannot apply to the day's
/// work is excluded from BOTH sums; zero possible weight → null, never 0.
/// <para>The monotonicity guarantee this shape exists to provide is proved
/// separately in <see cref="DayUnderstandingScoreMonotonicityTests"/>.</para>
/// </summary>
public sealed class DayUnderstandingScoreTests
{
    // ── helpers ──────────────────────────────────────────────────────────────
    private static ScoredDimension Dim(string name, int weight, double coverage,
        bool applicable = true, double confidenceFactor = 1.0)
        => new(name, weight, applicable, coverage, confidenceFactor);

    private static LensInput Roster(params ScoredDimension[] possible)
        => new([], [], [], possible);

    // ── the formula ──────────────────────────────────────────────────────────
    [Fact]
    public void EveryPossibleDimensionFullyCovered_scores_ten()
    {
        DayUnderstandingScore.From(Roster(
            Dim("WHAT", 20, 1.0), Dim("COST", 12, 1.0), Dim("WEATHER", 8, 1.0),
            Dim("OBS_FACET", 15, 1.0), Dim("LEARN_FACET", 15, 1.0)))
            .Should().Be(10);
    }

    [Fact]
    public void NothingCovered_but_something_was_possible_scores_zero_not_null()
    {
        // The assistant COULD have understood 70 points of the day and understood
        // none of it. That is an honest 0 — distinct from "nothing was scorable".
        DayUnderstandingScore.From(Roster(
            Dim("WHAT", 20, 0.0), Dim("COST", 12, 0.0), Dim("WEATHER", 8, 0.0),
            Dim("OBS_FACET", 15, 0.0), Dim("LEARN_FACET", 15, 0.0)))
            .Should().Be(0);
    }

    [Fact]
    public void HalfTheWeightCovered_scores_five()
    {
        // 20 of 40 possible → 5.0
        DayUnderstandingScore.From(Roster(Dim("A", 20, 1.0), Dim("B", 20, 0.0)))
            .Should().Be(5);
    }

    [Fact]
    public void PartialCoverage_counts_partially()
    {
        // (20·1 + 20·0.5) / 40 = 0.75 → 7.5 → 8
        DayUnderstandingScore.From(Roster(Dim("A", 20, 1.0), Dim("B", 20, 0.5)))
            .Should().Be(8);
    }

    [Fact]
    public void ConfidenceFactor_scales_the_numerator_only()
    {
        // (20·1·0.5) / 20 = 0.5 → 5. The dimension is still fully POSSIBLE.
        DayUnderstandingScore.From(Roster(Dim("A", 20, 1.0, confidenceFactor: 0.5)))
            .Should().Be(5);
    }

    [Fact]
    public void WeightsAreRespected_a_heavy_dimension_moves_the_number_more()
    {
        // heavy covered, light not: 20/32 = 0.625 → 6.25 → 6
        DayUnderstandingScore.From(Roster(Dim("WHAT", 20, 1.0), Dim("COST", 12, 0.0)))
            .Should().Be(6);
        // light covered, heavy not: 12/32 = 0.375 → 3.75 → 4
        DayUnderstandingScore.From(Roster(Dim("WHAT", 20, 0.0), Dim("COST", 12, 1.0)))
            .Should().Be(4);
    }

    // ── "no fabricated denominator" (project doctrine) ───────────────────────
    [Fact]
    public void NotApplicable_dimension_is_excluded_from_BOTH_sums()
    {
        // A pesticide DOSE on a day the farmer only irrigated cannot apply. It must
        // not be charged: the score is 10, not 20/(20+20) = 5.
        DayUnderstandingScore.From(Roster(
            Dim("WHAT", 20, 1.0),
            Dim("DOSE", 20, 0.0, applicable: false)))
            .Should().Be(10);
    }

    [Fact]
    public void AllDimensionsNotApplicable_returns_null_never_zero()
    {
        DayUnderstandingScore.From(Roster(
            Dim("DOSE", 20, 0.0, applicable: false),
            Dim("CARRIER", 10, 0.0, applicable: false)))
            .Should().BeNull();
    }

    [Fact]
    public void EmptyRoster_returns_null_no_score()
    {
        DayUnderstandingScore.From(Roster()).Should().BeNull();
    }

    [Fact]
    public void ZeroWeightRoster_returns_null_no_score()
    {
        DayUnderstandingScore.From(Roster(Dim("A", 0, 1.0))).Should().BeNull();
    }

    // ── rounding + clamping ──────────────────────────────────────────────────
    [Theory]
    [InlineData(45, 100, 5)]   // 4.5 → 5 (midpoint rounds up)
    [InlineData(75, 100, 8)]   // 7.5 → 8
    [InlineData(25, 100, 3)]   // 2.5 → 3
    [InlineData(5, 100, 1)]    // 0.5 → 1
    [InlineData(4, 100, 0)]    // 0.4 → 0
    [InlineData(44, 100, 4)]   // 4.4 → 4 (below midpoint rounds down)
    [InlineData(0, 100, 0)]    // an honest-but-empty day still scores 0, not null
    [InlineData(100, 100, 10)] // ceiling
    public void Ratio_rounds_at_the_midpoint_away_from_zero(int covered, int possible, int expected)
    {
        // One fully-covered dimension of weight `covered` plus one uncovered
        // dimension carrying the rest of the possible weight.
        DayUnderstandingScore.From(Roster(
            Dim("covered", covered, 1.0),
            Dim("rest", possible - covered, 0.0)))
            .Should().Be(expected);
    }

    [Theory]
    [InlineData(5.0)]   // corrupt row claiming 500% coverage
    [InlineData(99.0)]
    public void OutOfRange_coverage_cannot_push_the_score_above_ten(double coverage)
    {
        DayUnderstandingScore.From(Roster(Dim("A", 20, coverage))).Should().Be(10);
    }

    [Fact]
    public void NegativeCoverage_cannot_push_the_score_below_zero()
    {
        DayUnderstandingScore.From(Roster(Dim("A", 20, -3.0))).Should().Be(0);
    }

    // ── legacy rows (written before the completeness roster existed) ─────────
    [Fact]
    public void NoRoster_falls_back_to_the_union_of_the_three_lens_lists()
    {
        // Score what the old engine actually recorded rather than invent a
        // denominator for it: (20 + 8) / (20 + 12 + 8) = 0.7 → 7.
        var legacy = new LensInput(
            Execution: [Dim("WHAT", 20, 1.0), Dim("COST", 12, 0.0)],
            Insight: [Dim("WEATHER", 8, 1.0)],
            Learning: []);

        DayUnderstandingScore.From(legacy).Should().Be(7);
    }

    [Fact]
    public void EmptyRoster_on_a_legacy_row_still_falls_back_to_the_lenses()
    {
        var legacy = new LensInput(
            Execution: [Dim("WHAT", 20, 1.0)], Insight: [], Learning: [], Possible: []);

        DayUnderstandingScore.From(legacy).Should().Be(10);
    }

    [Fact]
    public void DeserializedEmptyObject_with_null_lists_returns_null_and_never_throws()
    {
        // components_json of "{}" round-trips to a LensInput whose members are all
        // null. That is "nothing scorable" — null, not a crash and not a 0.
        var fromEmptyJson = System.Text.Json.JsonSerializer.Deserialize<LensInput>("{}");

        fromEmptyJson.Should().NotBeNull();
        DayUnderstandingScore.From(fromEmptyJson).Should().BeNull();
    }

    [Fact]
    public void RoundTripsThroughComponentsJson_unchanged()
    {
        // The read path re-derives the score from the persisted per-dimension
        // breakdown, so the serialized shape must survive the round trip.
        var input = new LensInput(
            Execution: [Dim("WHAT", 20, 1.0), Dim("COST", 12, 0.5)],
            Insight: [Dim("WEATHER", 8, 1.0)],
            Learning: [],
            Possible: [Dim("WHAT", 20, 1.0), Dim("COST", 12, 0.5), Dim("WEATHER", 8, 1.0),
                       Dim("OBS_FACET", 15, 0.0), Dim("LEARN_FACET", 15, 0.0)]);

        var json = System.Text.Json.JsonSerializer.Serialize(input);
        var restored = System.Text.Json.JsonSerializer.Deserialize<LensInput>(json);

        restored.Should().NotBeNull();
        DayUnderstandingScore.From(restored).Should().Be(DayUnderstandingScore.From(input));
    }

    [Fact]
    public void NullInput_throws_rather_than_inventing_a_score()
    {
        var act = () => DayUnderstandingScore.From(null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Version_is_tied_to_the_score_engine_version()
    {
        DayUnderstandingScore.Version.Should().Be(DfesTuning.ScoreEngineVersion);
        DayUnderstandingScore.Version.Should().Be("dfes-3");
    }
}
