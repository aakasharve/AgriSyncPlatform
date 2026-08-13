using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11. THE acceptance criterion for the Day
/// Understanding Score: the number the farmer is told to chase must never FALL
/// because he was helpful.
///
/// <para>The screen promises, in Marathi, "tell me this and the number goes up".
/// The rollup this replaced took the arithmetic MEAN over whichever lenses
/// happened to be applicable, so a fresh signal in a previously-silent lens
/// pulled the mean DOWN — Execution 48 / Insight 100 → 7 became
/// 48 / 100 / 40 → 6 the moment the farmer answered Sathi's question. That exact
/// regression is reproduced below against a verbatim copy of the old rollup.</para>
///
/// <para><b>The property, stated precisely.</b> Hold the day's completeness roster
/// fixed — the same work happened, so the same dimensions could apply to it — and
/// raise the coverage of any subset of dimensions. The score must not fall. These
/// are exhaustive sweeps over the coverage lattice {0, 0.5, 1}^n for several roster
/// shapes, not a single happy path.</para>
/// </summary>
public sealed class DayUnderstandingScoreMonotonicityTests
{
    private static readonly double[] CoverageLevels = [0.0, 0.5, 1.0];

    // ── the property, swept exhaustively ─────────────────────────────────────

    /// <summary>Raising ONE dimension by ONE coverage step, from EVERY reachable
    /// starting point, never lowers the score.</summary>
    [Theory]
    [InlineData("20,12,8,15,15")]        // the always-possible roster (WHAT/COST/WEATHER/OBS/LEARN)
    [InlineData("20,12,20,8,15,15")]     // + DOSE (an input operation happened)
    [InlineData("20,12,20,10,8,15,15")]  // + DOSE + CARRIER (the full spray-day roster)
    [InlineData("1,1,1,1")]              // degenerate equal weights
    [InlineData("50,1,1,1,1")]           // one dominating dimension
    public void RaisingAnyDimensionOneStep_never_lowers_the_score(string weightCsv)
    {
        var weights = ParseWeights(weightCsv);
        var checks = 0;

        foreach (var coverage in AllCoverageVectors(weights.Length))
        {
            var before = ScoreOf(weights, coverage);

            for (var i = 0; i < weights.Length; i++)
            {
                for (var step = 1; step < CoverageLevels.Length; step++)
                {
                    var level = Array.IndexOf(CoverageLevels, coverage[i]) + step;
                    if (level >= CoverageLevels.Length)
                    {
                        continue;
                    }

                    var raised = (double[])coverage.Clone();
                    raised[i] = CoverageLevels[level];

                    checks++;
                    ScoreOf(weights, raised).Should().BeGreaterThanOrEqualTo(
                        before,
                        $"raising [{weightCsv}][{i}] from {coverage[i]} to {raised[i]} is the farmer TELLING US MORE "
                        + $"(coverage {string.Join('/', coverage)} → {string.Join('/', raised)})");
                }
            }
        }

        checks.Should().BeGreaterThan(0, "the sweep must actually have compared something");
    }

    /// <summary>The full lattice statement: if every dimension is covered at least
    /// as well, the score is at least as high (componentwise domination, all pairs).</summary>
    [Theory]
    [InlineData("20,12,8,15")]
    [InlineData("20,12,20,10")]
    public void ComponentwiseMoreCoverage_is_never_a_lower_score(string weightCsv)
    {
        var weights = ParseWeights(weightCsv);
        var vectors = AllCoverageVectors(weights.Length).ToList();

        foreach (var lower in vectors)
        {
            var lowerScore = ScoreOf(weights, lower);

            foreach (var higher in vectors.Where(h => Dominates(h, lower)))
            {
                ScoreOf(weights, higher).Should().BeGreaterThanOrEqualTo(
                    lowerScore,
                    $"{string.Join('/', higher)} covers at least as much as {string.Join('/', lower)}");
            }
        }
    }

    // ── new-lens monotonicity (the 7→6 scenario) ─────────────────────────────

    /// <summary>A day with NO Learning signal, then given its FIRST one, must never
    /// score lower — whatever the rest of the day looked like.</summary>
    [Fact]
    public void FirstLearningSignal_never_lowers_the_score()
    {
        // WHAT / COST / WEATHER / OBS_FACET / LEARN_FACET — LEARN_FACET last.
        int[] weights = [20, 12, 8, 15, 15];

        foreach (var rest in AllCoverageVectors(weights.Length - 1))
        {
            var without = rest.Append(0.0).ToArray();  // no learning shared yet
            var with = rest.Append(1.0).ToArray();     // the farmer answers Sathi

            ScoreOf(weights, with).Should().BeGreaterThanOrEqualTo(
                ScoreOf(weights, without),
                "a FIRST learning remark is the farmer being helpful — it may never cost him the number");
        }
    }

    /// <summary>Same guarantee for the first structured observation.</summary>
    [Fact]
    public void FirstObservationSignal_never_lowers_the_score()
    {
        int[] weights = [20, 12, 8, 15, 15]; // OBS_FACET is index 3

        foreach (var rest in AllCoverageVectors(4))
        {
            double[] without = [rest[0], rest[1], rest[2], 0.0, rest[3]];
            double[] with = [rest[0], rest[1], rest[2], 1.0, rest[3]];

            ScoreOf(weights, with).Should().BeGreaterThanOrEqualTo(ScoreOf(weights, without));
        }
    }

    // ── the regression the old rollup actually produced ──────────────────────

    /// <summary>
    /// The founder's worked example, arithmetic-exact. Execution 48, Insight 100,
    /// Learning not-applicable → the OLD rollup said mean(48, 100) = 74 → 7. The
    /// farmer answered Sathi's question, which introduced a Learning signal worth
    /// 40 → mean(48, 100, 40) = 62.67 → 6. He did exactly what was asked and the
    /// number FELL. The new rollup rises instead.
    /// </summary>
    [Fact]
    public void The_old_rollup_fell_from_7_to_6_where_the_new_one_rises()
    {
        // The same underlying day, expressed as dimensions. The Learning dimension is
        // ALWAYS in the completeness roster — at coverage 0 before the farmer answers,
        // at 0.4 after — which is precisely what removes the cliff.
        var before = Day(learningCoverage: 0.0);
        var after = Day(learningCoverage: 0.4);

        // The old engine, verbatim, on the same two days. Before the farmer answered,
        // the Learning LENS did not exist at all (that is what made it excluded).
        var legacyBefore = LegacyDayUnderstandingRollup.MeanOverApplicableLenses(
            ThreeLensScorer.Score(new LensInput(before.Execution, before.Insight, [])));
        var legacyAfter = LegacyDayUnderstandingRollup.MeanOverApplicableLenses(
            ThreeLensScorer.Score(after));

        legacyBefore.Should().Be(7, "mean(Execution 48, Insight 100) = 74 → 7");
        legacyAfter.Should().Be(6, "mean(48, 100, 40) = 62.67 → 6 — the defect");
        legacyAfter.Should().BeLessThan(legacyBefore!.Value, "this is the bug being fixed");

        // The new engine on the same two days.
        var newBefore = DayUnderstandingScore.From(before);
        var newAfter = DayUnderstandingScore.From(after);

        newBefore.Should().Be(5, "(48 + 100 + 0) / 300 = 0.493 → 5");
        newAfter.Should().Be(6, "(48 + 100 + 40) / 300 = 0.627 → 6");
        newAfter.Should().BeGreaterThanOrEqualTo(newBefore!.Value, "answering Sathi may only ever help");

        static LensInput Day(double learningCoverage)
        {
            // Lens scores of exactly 48 / 100 / (100 · learningCoverage).
            ScoredDimension execution = new("EXECUTION", 100, true, 0.48, 1.0);
            ScoredDimension insight = new("INSIGHT", 100, true, 1.0, 1.0);
            ScoredDimension learning = new("LEARNING", 100, true, learningCoverage, 1.0);

            return new LensInput(
                Execution: [execution],
                Insight: [insight],
                Learning: [learning],
                Possible: [execution, insight, learning]);
        }
    }

    // ── dimensions that cannot apply must not move the number at all ─────────

    [Theory]
    [InlineData(1)]
    [InlineData(20)]
    [InlineData(500)]
    public void NotApplicable_dimension_of_any_weight_leaves_the_score_untouched(int deadWeight)
    {
        int[] weights = [20, 12, 8, 15, 15];

        foreach (var coverage in AllCoverageVectors(weights.Length))
        {
            var baseline = ScoreOf(weights, coverage);

            var withDeadDimension = Dimensions(weights, coverage)
                .Append(new ScoredDimension("DOSE", deadWeight, false, 0.0, 1.0))
                .ToArray();

            DayUnderstandingScore.From(new LensInput([], [], [], withDeadDimension))
                .Should().Be(baseline, "work the farmer did not do is never charged to him");
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    private static int[] ParseWeights(string csv)
        => csv.Split(',').Select(int.Parse).ToArray();

    private static ScoredDimension[] Dimensions(int[] weights, double[] coverage)
        => [.. weights.Select((w, i) => new ScoredDimension($"D{i}", w, true, coverage[i], 1.0))];

    private static int ScoreOf(int[] weights, double[] coverage)
    {
        var score = DayUnderstandingScore.From(new LensInput([], [], [], Dimensions(weights, coverage)));
        score.Should().NotBeNull("every dimension in these sweeps is applicable with positive weight");
        return score!.Value;
    }

    private static bool Dominates(double[] higher, double[] lower)
        => !higher.Where((h, i) => h < lower[i]).Any();

    // Every point of the coverage lattice {0, 0.5, 1}^n.
    private static IEnumerable<double[]> AllCoverageVectors(int n)
    {
        var total = (int)Math.Pow(CoverageLevels.Length, n);
        for (var code = 0; code < total; code++)
        {
            var vector = new double[n];
            var remaining = code;
            for (var i = 0; i < n; i++)
            {
                vector[i] = CoverageLevels[remaining % CoverageLevels.Length];
                remaining /= CoverageLevels.Length;
            }

            yield return vector;
        }
    }
}
